import type { Prisma } from "@sokosumi/database";
import {
  type CmoApplyLog,
  type CmoApplyOp,
  cmoApplyLogSchema,
  type MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import {
  parseMarketingPlan,
  UNPUBLISHED_POST_STATUSES,
} from "@/services/marketing-strategy.service";

/**
 * cmo-v25: an owner's change to the running month (design v5, ADR 0085's
 * follow-up). The step's candidate version carries a durable apply log: the
 * base it was written on, then each post change as an intent before Social
 * is called and done or refused after. Once every post change is in, the
 * candidate becomes the approved version: the base's approval is cleared
 * first (the one-approved index is checked at once), the base's unpublished
 * posts follow it. Before that commit, a crash is rolled back; nothing ever
 * finishes a change the owner's month never committed.
 *
 * Every write takes the Project's lock, then the candidate row's, in that
 * order, and reads the candidate only after holding both. One apply runs
 * per Project at a time.
 */

/** An apply whose log has not moved this long crashed with its invocation. */
export const CMO_APPLY_STALE_MS = 10 * 60_000;

/** Applies still running: no other may start on the Project meanwhile. */
const OPEN_STATES = ["applying", "undoing"] as const;

interface LockedCandidate {
  id: string;
  projectId: string;
  approvedAt: Date | null;
  plan: MarketingStrategyPlan;
}

/**
 * The candidate under the Project's lock and its own row lock, read after
 * both are held, so no write races another on a stale copy.
 */
async function lockCandidate(
  tx: Prisma.TransactionClient,
  candidateId: string,
): Promise<LockedCandidate | null> {
  const owner = await tx.marketingStrategy.findUnique({
    where: { id: candidateId },
    select: { projectId: true },
  });
  if (!owner) return null;
  await tx.$executeRaw`SELECT 1 FROM project WHERE id = ${owner.projectId}::uuid FOR UPDATE`;
  await tx.$executeRaw`SELECT 1 FROM marketing_strategy WHERE id = ${candidateId}::uuid FOR UPDATE`;
  const row = await tx.marketingStrategy.findUnique({
    where: { id: candidateId },
    select: { id: true, projectId: true, approvedAt: true, plan: true },
  });
  const plan = parseMarketingPlan(row?.plan);
  return row && plan ? { ...row, plan } : null;
}

async function writeLog(
  tx: Prisma.TransactionClient,
  candidate: LockedCandidate,
  log: CmoApplyLog,
  now: Date,
  extra: Prisma.MarketingStrategyUncheckedUpdateInput = {},
) {
  await tx.marketingStrategy.update({
    where: { id: candidate.id },
    data: {
      ...extra,
      plan: jsonInput({
        ...candidate.plan,
        applyLog: { ...log, updatedAt: now.toISOString() },
      }),
    },
  });
}

/** The approved version a change was written on, unchanged since. */
async function baseStillApproved(
  tx: Prisma.TransactionClient,
  projectId: string,
  base: { id: string; updatedAt: string },
): Promise<boolean> {
  const approved = await tx.marketingStrategy.findFirst({
    where: { projectId, approvedAt: { not: null } },
    select: { id: true, updatedAt: true },
  });
  return (
    approved?.id === base.id &&
    approved.updatedAt.toISOString() === base.updatedAt
  );
}

/** Another version of the Project with an apply still running. */
async function otherOpenApply(
  tx: Prisma.TransactionClient,
  projectId: string,
  candidateId: string,
): Promise<boolean> {
  const open = await tx.marketingStrategy.findFirst({
    where: {
      projectId,
      id: { not: candidateId },
      OR: OPEN_STATES.map((state) => ({
        plan: { path: ["applyLog", "state"], equals: state },
      })),
    },
    select: { id: true },
  });
  return open !== null;
}

export type CmoApplyStart =
  | { started: true }
  | { started: false; reason: string };

/**
 * Opens an apply on the candidate: an unapproved version other than its
 * base, on the approved version the change was written on, still
 * unchanged, while no other apply runs on the Project. A stale base leaves
 * the candidate a proposal (`left`).
 */
export async function beginCmoChangeApply(input: {
  candidateId: string;
  baseVersionId: string;
  baseUpdatedAt: string;
  now?: Date;
}): Promise<CmoApplyStart> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const candidate = await lockCandidate(tx, input.candidateId);
    if (!candidate) return { started: false, reason: "no candidate version" };
    if (candidate.approvedAt || candidate.id === input.baseVersionId)
      return { started: false, reason: "the candidate is already approved" };
    if (candidate.plan.applyLog)
      return { started: false, reason: "this change was applied before" };
    if (await otherOpenApply(tx, candidate.projectId, candidate.id))
      return {
        started: false,
        reason: "another change is being applied to the month",
      };
    const log: CmoApplyLog = {
      baseVersionId: input.baseVersionId,
      baseUpdatedAt: input.baseUpdatedAt,
      state: "applying",
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ops: [],
    };
    const fresh = await baseStillApproved(tx, candidate.projectId, {
      id: input.baseVersionId,
      updatedAt: input.baseUpdatedAt,
    });
    if (!fresh) {
      await writeLog(
        tx,
        candidate,
        { ...log, state: "left", endedAt: now.toISOString() },
        now,
      );
      return {
        started: false,
        reason: "the month changed since the change was written",
      };
    }
    await writeLog(tx, candidate, log, now);
    return { started: true };
  });
}

/**
 * Writes one op into a running apply's log, by its id: as an intent before
 * Social is called, then done or refused (and while undoing, the undo's
 * outcome). A settled log takes no op.
 */
export async function recordCmoApplyOp(
  candidateId: string,
  op: CmoApplyOp,
  now: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const candidate = await lockCandidate(tx, candidateId);
    const log = candidate?.plan.applyLog;
    if (!candidate || !log) throw new Error("No apply is open on that version");
    if (!(OPEN_STATES as readonly string[]).includes(log.state))
      throw new Error(`The apply is ${log.state}; it takes no more ops`);
    const ops = log.ops.some((item) => item.opId === op.opId)
      ? log.ops.map((item) => (item.opId === op.opId ? op : item))
      : [...log.ops, op];
    await writeLog(tx, candidate, { ...log, ops }, now);
  });
}

export type CmoApplyCommit =
  | "applied"
  | "base_changed"
  | "not_applying"
  | "ops_open";

/**
 * Makes the candidate the approved version once its post changes are in:
 * only while it is still applying and the base is still the approved
 * version, unchanged. The base's approval is cleared before the candidate's
 * is set, since the one-approved index is checked at once; the base's
 * unpublished posts follow the candidate, and its written files for the
 * entries the candidate still has.
 */
export async function commitCmoChangeApply(input: {
  candidateId: string;
  approverUserId: string;
  now?: Date;
}): Promise<CmoApplyCommit> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const candidate = await lockCandidate(tx, input.candidateId);
    const log = candidate?.plan.applyLog;
    if (!candidate || log?.state !== "applying") return "not_applying";
    // Recovery passes over an applied version, so an op still an intent
    // would never be settled: every op is done or refused first.
    if (log.ops.some((item) => item.state === "intent")) return "ops_open";
    const fresh = await baseStillApproved(tx, candidate.projectId, {
      id: log.baseVersionId,
      updatedAt: log.baseUpdatedAt,
    });
    if (!fresh) return "base_changed";
    await tx.marketingStrategy.update({
      where: { id: log.baseVersionId },
      data: { approvedAt: null, approvedByUserId: null },
    });
    await writeLog(
      tx,
      candidate,
      { ...log, state: "applied", endedAt: now.toISOString() },
      now,
      { approvedAt: now, approvedByUserId: input.approverUserId },
    );
    await tx.socialPost.updateMany({
      where: {
        marketingStrategyId: log.baseVersionId,
        status: { in: [...UNPUBLISHED_POST_STATUSES] },
      },
      data: { marketingStrategyId: input.candidateId },
    });
    const entries = candidate.plan.calendar.map((entry) => entry.id);
    const files = await tx.marketingStrategyFile.findMany({
      where: {
        marketingStrategyId: log.baseVersionId,
        entryId: { in: entries },
      },
      select: { entryId: true, fileResourceId: true, mediaFileIds: true },
    });
    if (files.length > 0)
      await tx.marketingStrategyFile.createMany({
        data: files.map((file) => ({
          ...file,
          marketingStrategyId: input.candidateId,
        })),
        skipDuplicates: true,
      });
    return "applied";
  });
}

/**
 * The moves an apply's state may make: applying → undoing (rolled back),
 * applied → undoing (Go back), undoing → undone. Undoing opens a change
 * on the Project, so it waits while another one is open there.
 */
const NEXT_STATES: Partial<
  Record<CmoApplyLog["state"], readonly CmoApplyLog["state"][]>
> = {
  applying: ["undoing"],
  applied: ["undoing"],
  undoing: ["undone"],
};

/** Moves a candidate's apply to its next state; false when it may not. */
export async function setCmoApplyState(
  candidateId: string,
  state: CmoApplyLog["state"],
  now: Date = new Date(),
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const candidate = await lockCandidate(tx, candidateId);
    const log = candidate?.plan.applyLog;
    if (!candidate || !log || !NEXT_STATES[log.state]?.includes(state))
      return false;
    if (
      state === "undoing" &&
      (await otherOpenApply(tx, candidate.projectId, candidate.id))
    )
      return false;
    await writeLog(
      tx,
      candidate,
      {
        ...log,
        state,
        ...(state === "undone" ? { endedAt: now.toISOString() } : {}),
      },
      now,
    );
    return true;
  });
}

/** What recovery does with one op of a crashed apply. */
export type CmoApplyRecoveryStep =
  /** The op may have reached its post: undo it (revision-guarded). */
  | { op: CmoApplyOp; action: "undo" }
  /** Refused, so nothing to undo. */
  | { op: CmoApplyOp; action: "none" };

/**
 * A crashed apply's way back (design v5). An apply never commits before all
 * its post changes are done, so one stuck in `applying` or `undoing` is
 * rolled back, newest op first: every op that may have written (done, or an
 * intent whose post may carry its id) is undone, a swap by taking off the
 * replacement it made and keeping the original. Nothing is finished forward.
 */
export function cmoApplyRecovery(log: CmoApplyLog): CmoApplyRecoveryStep[] {
  if (log.state !== "applying" && log.state !== "undoing") return [];
  return [...log.ops]
    .reverse()
    .map((op) => ({ op, action: op.state === "refused" ? "none" : "undo" }));
}

/**
 * Versions whose apply is still applying or undoing but whose log has not
 * moved past its limit: a change or a Go back (whose version is still
 * approved while it undoes) that crashed with its invocation.
 */
export async function staleCmoApplies(
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await prisma.marketingStrategy.findMany({
    where: {
      OR: OPEN_STATES.map((state) => ({
        plan: { path: ["applyLog", "state"], equals: state },
      })),
    },
    select: { id: true, plan: true },
  });
  return rows
    .filter((row) => {
      const updatedAt = Date.parse(cmoApplyLogOf(row.plan)?.updatedAt ?? "");
      return updatedAt < now.getTime() - CMO_APPLY_STALE_MS;
    })
    .map((row) => row.id);
}

/** The apply log a stored plan carries, if any. */
export function cmoApplyLogOf(plan: unknown): CmoApplyLog | null {
  const parsed = cmoApplyLogSchema.safeParse(
    (plan as { applyLog?: unknown } | null)?.applyLog,
  );
  return parsed.success ? parsed.data : null;
}
