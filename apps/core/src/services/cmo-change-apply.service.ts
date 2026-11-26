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
 */

/** An apply left in a state this long crashed with its invocation. */
export const CMO_APPLY_STALE_MS = 10 * 60_000;

async function lockProject(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$executeRaw`SELECT 1 FROM project WHERE id = ${projectId}::uuid FOR UPDATE`;
}

async function readCandidate(
  tx: Prisma.TransactionClient,
  candidateId: string,
): Promise<{ plan: MarketingStrategyPlan; projectId: string } | null> {
  const row = await tx.marketingStrategy.findUnique({
    where: { id: candidateId },
    select: { plan: true, projectId: true, approvedAt: true },
  });
  const plan = parseMarketingPlan(row?.plan);
  return row && plan ? { plan, projectId: row.projectId } : null;
}

async function writeLog(
  tx: Prisma.TransactionClient,
  candidateId: string,
  plan: MarketingStrategyPlan,
  log: CmoApplyLog,
) {
  await tx.marketingStrategy.update({
    where: { id: candidateId },
    data: { plan: jsonInput({ ...plan, applyLog: log }) },
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

export type CmoApplyStart =
  | { started: true }
  | { started: false; reason: string };

/**
 * Opens an apply on the candidate, under the Project's lock: only on the
 * approved version the change was written on, still unchanged. Otherwise
 * the candidate stays a proposal (`left`).
 */
export async function beginCmoChangeApply(input: {
  candidateId: string;
  baseVersionId: string;
  baseUpdatedAt: string;
  now?: Date;
}): Promise<CmoApplyStart> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const candidate = await readCandidate(tx, input.candidateId);
    if (!candidate) return { started: false, reason: "no candidate version" };
    await lockProject(tx, candidate.projectId);
    const log: CmoApplyLog = {
      baseVersionId: input.baseVersionId,
      baseUpdatedAt: input.baseUpdatedAt,
      state: "applying",
      startedAt: now.toISOString(),
      ops: [],
    };
    if (candidate.plan.applyLog)
      return { started: false, reason: "this change was applied before" };
    const fresh = await baseStillApproved(tx, candidate.projectId, {
      id: input.baseVersionId,
      updatedAt: input.baseUpdatedAt,
    });
    if (!fresh) {
      await writeLog(tx, input.candidateId, candidate.plan, {
        ...log,
        state: "left",
        endedAt: now.toISOString(),
      });
      return {
        started: false,
        reason: "the month changed since the change was written",
      };
    }
    await writeLog(tx, input.candidateId, candidate.plan, log);
    return { started: true };
  });
}

/**
 * Writes one op into the candidate's log, by its id: as an intent before
 * Social is called, then done or refused. Its own short transaction, under
 * the candidate row's lock, so ops written one after another never lose
 * each other.
 */
export async function recordCmoApplyOp(
  candidateId: string,
  op: CmoApplyOp,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM marketing_strategy WHERE id = ${candidateId}::uuid FOR UPDATE`;
    const candidate = await readCandidate(tx, candidateId);
    const log = candidate?.plan.applyLog;
    if (!candidate || !log) throw new Error("No apply is open on that version");
    const ops = log.ops.some((item) => item.opId === op.opId)
      ? log.ops.map((item) => (item.opId === op.opId ? op : item))
      : [...log.ops, op];
    await writeLog(tx, candidateId, candidate.plan, { ...log, ops });
  });
}

export type CmoApplyCommit = "applied" | "base_changed" | "not_applying";

/**
 * Makes the candidate the approved version once its post changes are in:
 * under the Project's lock, the base must still be the approved version,
 * unchanged. The base's approval is cleared before the candidate's is set,
 * since the one-approved index is checked at once; the base's unpublished
 * posts and written files follow the candidate.
 */
export async function commitCmoChangeApply(input: {
  candidateId: string;
  approverUserId: string;
  now?: Date;
}): Promise<CmoApplyCommit> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const candidate = await readCandidate(tx, input.candidateId);
    const log = candidate?.plan.applyLog;
    if (!candidate || log?.state !== "applying") return "not_applying";
    await lockProject(tx, candidate.projectId);
    const fresh = await baseStillApproved(tx, candidate.projectId, {
      id: log.baseVersionId,
      updatedAt: log.baseUpdatedAt,
    });
    if (!fresh) return "base_changed";
    await tx.marketingStrategy.update({
      where: { id: log.baseVersionId },
      data: { approvedAt: null, approvedByUserId: null },
    });
    await tx.marketingStrategy.update({
      where: { id: input.candidateId },
      data: {
        approvedAt: now,
        approvedByUserId: input.approverUserId,
        plan: jsonInput({
          ...candidate.plan,
          applyLog: { ...log, state: "applied", endedAt: now.toISOString() },
        }),
      },
    });
    await tx.socialPost.updateMany({
      where: {
        marketingStrategyId: log.baseVersionId,
        status: { in: [...UNPUBLISHED_POST_STATUSES] },
      },
      data: { marketingStrategyId: input.candidateId },
    });
    const files = await tx.marketingStrategyFile.findMany({
      where: { marketingStrategyId: log.baseVersionId },
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

/** Moves a candidate's apply to another state (undoing, undone). */
export async function setCmoApplyState(
  candidateId: string,
  state: CmoApplyLog["state"],
  now: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM marketing_strategy WHERE id = ${candidateId}::uuid FOR UPDATE`;
    const candidate = await readCandidate(tx, candidateId);
    const log = candidate?.plan.applyLog;
    if (!candidate || !log) return;
    await writeLog(tx, candidateId, candidate.plan, {
      ...log,
      state,
      ...(state === "undone" || state === "applied"
        ? { endedAt: now.toISOString() }
        : {}),
    });
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

/** Candidates whose apply has stood in `applying` or `undoing` past its limit. */
export async function staleCmoApplies(
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await prisma.marketingStrategy.findMany({
    where: {
      approvedAt: null,
      OR: ["applying", "undoing"].map((state) => ({
        plan: { path: ["applyLog", "state"], equals: state },
      })),
    },
    select: { id: true, plan: true },
  });
  return rows
    .filter((row) => {
      const startedAt = Date.parse(cmoApplyLogOf(row.plan)?.startedAt ?? "");
      return startedAt < now.getTime() - CMO_APPLY_STALE_MS;
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
