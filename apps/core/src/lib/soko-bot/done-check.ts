import { SOKO_BOT_TOOL_REFUSED } from "@sokosumi/soko-bot";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import {
  ACTION_CAPABILITIES,
  STUDIO_JOB_CAPABILITIES,
} from "@/lib/soko-bot/action-receipts";
import { parseActionNarrativeText } from "@/lib/soko-bot/action-response";
import { isOwnerRequest } from "@/lib/soko-bot/owner-request";
import {
  type ChainPlan,
  type PlanStep,
  readRequestPlan,
  resolveRequestId,
} from "@/lib/soko-bot/request-chain";
import {
  RECORDED_SAVES,
  RuntimeEventLog,
  runtimeEvent,
} from "@/lib/soko-bot/turn-loop";
import { resolveSokoBotVersion } from "@/services/soko-bot-version.service";

/** Recorded before the one bounce, so a restarted runner never bounces again. */
export const DONE_CHECK_BOUNCED_EVENT = "done_check.bounced";

const ACTIVE_RUN_STATUSES = ["QUEUED", "STARTING", "RUNNING"] as const;

function openSteps(plan: ChainPlan): PlanStep[] {
  return plan.steps.filter(
    (step) => step.status === "pending" || step.status === "in_progress",
  );
}

const stepList = (steps: readonly PlanStep[]) =>
  steps.map((step) => `- ${step.id} [${step.status}] ${step.step}`).join("\n");

async function turnPlan(turnId: string) {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: {
      sokoBotId: true,
      versionId: true,
      source: true,
      chainDepth: true,
      askedByUserId: true,
      requestedByUserId: true,
      parentTurnId: true,
      parentTurn: {
        select: {
          source: true,
          chainDepth: true,
          askedByUserId: true,
          requestedByUserId: true,
        },
      },
    },
  });
  if (!turn || !(await resolveSokoBotVersion(turn.versionId)).planLoop)
    return null;
  const requestId = await resolveRequestId(turnId);
  const plan = await readRequestPlan(turn.sokoBotId, requestId);
  return plan ? { turn, requestId, plan } : null;
}

/**
 * The plan's open steps, for the keep-going nudge and the time-up report,
 * so they name what is left rather than "the brief". Null without any.
 */
export async function openStepsNote(turnId: string): Promise<string | null> {
  const found = await turnPlan(turnId);
  if (!found || !openSteps(found.plan).length) return null;
  const left = await stepsLeft(
    found,
    await requestTurnIds(found.turn.sokoBotId, found.requestId, turnId),
  );
  const saved = savedNote(left.saves, found.plan.revision).trim();
  return [
    left.open.length
      ? `Open steps in your plan (revision ${found.plan.revision}):\n${stepList(left.open)}`
      : `Every open step in your plan (revision ${found.plan.revision}) is done by Core's receipts.`,
    doneNote(left.done),
    saved,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The plan's open steps as Core's receipts leave them: a step that names an
 * artifact a confirmed save made is done, whatever the plan's text still
 * says, so no reply calls it still to do.
 */
async function stepsLeft(
  found: NonNullable<Awaited<ReturnType<typeof turnPlan>>>,
  turnIds: readonly string[],
) {
  const saves = await savesSincePlan(
    found.turn.sokoBotId,
    found.requestId,
    found.plan,
    turnIds,
  );
  const open = openSteps(found.plan);
  return {
    saves,
    open: open.filter((step) => !doneByReceipt(step, saves)),
    done: open.filter((step) => doneByReceipt(step, saves)),
  };
}

function doneNote(done: readonly PlanStep[]): string {
  return done.length
    ? `Done by Core's receipts, though the plan still lists them (mark them done; do not say they are left):\n${done.map((step) => `- ${step.id} ${step.step}`).join("\n")}`
    : "";
}

const MAX_REQUEST_DEPTH = 6;
const MAX_REQUEST_TURNS = 100;

/**
 * Every turn of the request below its first: background runs, Coworker or
 * Agent follow-up wakes and watch wakes, finished ones included, since a run
 * that ended may have left a watch or a hand-over behind.
 */
async function requestTurnIds(
  sokoBotId: string,
  requestId: string,
  turnId: string,
): Promise<string[]> {
  const found = new Set([requestId, turnId]);
  let frontier = [...found];
  for (
    let depth = 0;
    depth < MAX_REQUEST_DEPTH &&
    frontier.length &&
    found.size < MAX_REQUEST_TURNS;
    depth++
  ) {
    const [children, handedOver, watched] = await Promise.all([
      prisma.sokoBotTurn.findMany({
        where: { sokoBotId, parentTurnId: { in: frontier } },
        select: { id: true },
        take: MAX_REQUEST_TURNS,
      }),
      prisma.sokoBotDelegation.findMany({
        where: { turnId: { in: frontier }, followUpTurnId: { not: null } },
        select: { followUpTurnId: true },
        take: MAX_REQUEST_TURNS,
      }),
      prisma.sokoBotWatch.findMany({
        where: { turnId: { in: frontier }, firedTurnId: { not: null } },
        select: { firedTurnId: true },
        take: MAX_REQUEST_TURNS,
      }),
    ]);
    const next = [
      ...children.map((row) => row.id),
      ...handedOver.map((row) => row.followUpTurnId),
      ...watched.map((row) => row.firedTurnId),
    ].filter((id): id is string => id !== null && !found.has(id));
    for (const id of next) found.add(id);
    frontier = [...new Set(next)];
  }
  return [...found];
}

/**
 * The request still waits on someone else, from any of its turns: a
 * hand-over whose follow-up has not come back, a watch, or a background run.
 * Pushing the bot on would only make it poll.
 */
async function waitingOnOthers(
  turnId: string,
  turnIds: readonly string[],
): Promise<boolean> {
  const ids = [...turnIds];
  const [delegation, watch, run] = await Promise.all([
    prisma.sokoBotDelegation.findFirst({
      where: {
        turnId: { in: ids },
        followUp: { not: null },
        followUpTurnId: null,
      },
      select: { id: true },
    }),
    prisma.sokoBotWatch.findFirst({
      where: { turnId: { in: ids }, status: "WAITING" },
      select: { id: true },
    }),
    prisma.sokoBotTurn.findFirst({
      where: {
        parentTurnId: { in: ids },
        id: { not: turnId },
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(delegation || watch || run);
}

/** A receipt's outcome as Core recorded it, and what the bot should do. */
type ReceiptOutcome = "done" | "started" | "not done" | "unconfirmed";

interface SaveReceipt {
  capability: string;
  /** What it was about: the file's name, and Core's id for it. */
  label: string;
  /** The artifact's name as a step might say it, lower case. */
  names: string[];
  outcome: ReceiptOutcome;
}

const nameSchema = z.object({
  filename: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
});

/** The artifact a receipt is about, so two saves of one tool tell apart. */
function artifactName(result: unknown): string | undefined {
  const named = nameSchema.safeParse(result).data;
  return (named?.filename ?? named?.name ?? named?.title)
    ?.replace(/\s+/g, " ")
    .slice(0, 80);
}

function receiptLabel(targetId: string | null, result: unknown): string {
  const name = artifactName(result);
  // A strategy save has no ledger target; its version is what it made.
  const version = z.object({ versionId: z.string() }).safeParse(result)
    .data?.versionId;
  const id = targetId ?? version;
  return [name ? `"${name}"` : null, id ? `id ${id}` : null]
    .filter(Boolean)
    .join(", ");
}

/** "Minutes.md" is named "minutes.md" or, in a step, just "minutes". */
function receiptNames(result: unknown): string[] {
  const name = artifactName(result)?.toLowerCase().trim();
  if (!name) return [];
  const base = name.replace(/\.[a-z0-9]{1,5}$/, "");
  return [...new Set([name, base])].filter((each) => each.length >= 3);
}

/** A step a save Core confirmed already did: it names that save's artifact. */
function doneByReceipt(step: PlanStep, saves: readonly SaveReceipt[]): boolean {
  const text = step.step.toLowerCase();
  return saves.some(
    (save) =>
      save.outcome === "done" && save.names.some((name) => text.includes(name)),
  );
}

const STUDIO_RUNNING = new Set(["PENDING", "SUBMITTING", "QUEUED", "RUNNING"]);
const STUDIO_NOT_MADE = new Set(["FAILED", "CANCELED", "ORPHANED"]);

/**
 * The outcome Core recorded. Refused is not done; uncertain is unconfirmed,
 * since it may have happened. A Studio job is done only once it made its
 * asset. A Core-checked save (#8278's recorded saves) is done when its own
 * check says so; anything else completed is done.
 */
async function receiptOutcome(call: {
  capability: string;
  disposition: string | null;
  targetId: string | null;
  result: unknown;
}): Promise<ReceiptOutcome> {
  if (call.disposition === "REJECTED") return "not done";
  if (call.disposition === "UNKNOWN") return "unconfirmed";
  // A save Core is still writing (write_strategy's { writing: true }).
  if (z.object({ writing: z.literal(true) }).safeParse(call.result).success)
    return "started";
  const recorded = RECORDED_SAVES[call.capability];
  if (recorded)
    return !recorded.confirmed || recorded.confirmed(call.result)
      ? "done"
      : "not done";
  if (!STUDIO_JOB_CAPABILITIES.has(call.capability)) return "done";
  if (!call.targetId) return "unconfirmed";
  const job = await prisma.projectImageJob.findUnique({
    where: { id: call.targetId },
    select: { status: true },
  });
  if (job?.status === "SUCCEEDED") return "done";
  if (job && STUDIO_RUNNING.has(job.status)) return "started";
  return job && STUDIO_NOT_MADE.has(job.status) ? "not done" : "unconfirmed";
}

/**
 * What the request saved after its plan's newest revision, from Core's own
 * receipts and their recorded outcomes: the plan's text may not show those
 * steps yet, and the bot must not be told, or tell the owner, that a save
 * that worked is still to do, nor that one that failed was done.
 */
async function savesSincePlan(
  sokoBotId: string,
  requestId: string,
  plan: ChainPlan,
  turnIds: readonly string[],
): Promise<SaveReceipt[]> {
  const written = await prisma.sokoBotToolCall.findFirst({
    where: {
      turn: { sokoBotId },
      capability: "update_plan",
      status: { not: "FAILED" },
      AND: [
        { result: { path: ["requestId"], equals: requestId } },
        { result: { path: ["revision"], equals: plan.revision } },
      ],
    },
    select: { createdAt: true },
  });
  if (!written) return [];
  const calls = await prisma.sokoBotToolCall.findMany({
    where: {
      turnId: { in: [...turnIds] },
      status: "COMPLETED",
      capability: {
        in: [...ACTION_CAPABILITIES, ...Object.keys(RECORDED_SAVES)],
      },
      createdAt: { gt: written.createdAt },
    },
    orderBy: { createdAt: "asc" },
    select: {
      capability: true,
      disposition: true,
      targetId: true,
      result: true,
    },
    take: 20,
  });
  return Promise.all(
    calls.map(async (call) => ({
      capability: call.capability,
      label: receiptLabel(call.targetId, call.result),
      names: receiptNames(call.result),
      outcome: await receiptOutcome(call),
    })),
  );
}

const OUTCOME_WORDS: Record<ReceiptOutcome, string> = {
  done: "done",
  started: "started, not finished yet",
  "not done": "did not happen",
  unconfirmed: "Core could not confirm whether it happened",
};

/** The saves the plan does not show yet, and what to do about them. */
function savedNote(saves: readonly SaveReceipt[], revision: number): string {
  if (!saves.length) return "";
  const lines = saves
    .map(
      (save) =>
        `- ${save.capability}${save.label ? ` (${save.label})` : ""}: ${OUTCOME_WORDS[save.outcome]}`,
    )
    .join("\n");
  return `Since your plan's revision ${revision}, Core's receipts show:\n${lines}\nMark the steps done saves finished done with update_plan (revision ${revision}) and do not do them again. A step whose save did not happen is still open: do it again if you can, or mark it blocked with the reason. One whose work only started is under way: do not start it again; wait for it (follow what its tool said) and keep its step in progress until it finishes. One Core could not confirm may have happened: read back whether it did before anything else, never repeat it blind, and if you cannot tell, mark it blocked with the reason and say so.\n`;
}

/** The draft asks the owner something: its clarification, or a question. */
function asksOwner(draft: string): boolean {
  const narrative = parseActionNarrativeText(draft);
  return narrative
    ? narrative.kind === "CLARIFY" || narrative.question !== null
    : /\?(\s|$)/.test(draft);
}

/**
 * The turn still stops on the owner: a decision nobody has answered, or a
 * refusal no later call of the same tool made good.
 */
async function ownerBlocker(turnId: string): Promise<boolean> {
  const decision = await prisma.sokoBotPendingDecision.findFirst({
    where: { turnId, status: "PENDING" },
    select: { id: true },
  });
  if (decision) return true;
  const calls = await prisma.sokoBotToolCall.findMany({
    where: { turnId },
    orderBy: { createdAt: "asc" },
    select: { capability: true, status: true, errorKind: true },
  });
  return calls.some(
    (call, index) =>
      call.errorKind === SOKO_BOT_TOOL_REFUSED &&
      !calls
        .slice(index + 1)
        .some(
          (later) =>
            later.capability === call.capability &&
            later.status === "COMPLETED",
        ),
  );
}

/**
 * The done check (planLoop): a foreground owner turn about to answer while
 * its plan still lists steps to do is sent back once to do them or to mark
 * them blocked or skipped. A turn that waits on the owner is asked to mark
 * what needs their answer blocked and to do the rest, so a question about
 * one step does not leave the others undone. Null lets the answer through:
 * no plan, nothing open, the request waits on others, or it already bounced.
 */
export async function evaluateTurnDoneCheck(input: {
  turnId: string;
  sessionId: string;
  draft: string;
}): Promise<string | null> {
  const found = await turnPlan(input.turnId);
  if (!found || !isOwnerRequest(found.turn, { schedules: true })) return null;
  if (!openSteps(found.plan).length) return null;
  const turnIds = await requestTurnIds(
    found.turn.sokoBotId,
    found.requestId,
    input.turnId,
  );
  const left = await stepsLeft(found, turnIds);
  const { open } = left;
  const working = open.some((step) => step.status === "in_progress");
  if (!working && (await waitingOnOthers(input.turnId, turnIds))) return null;
  const saved = savedNote(left.saves, found.plan.revision);
  const done = doneNote(left.done);
  const claim = () =>
    new RuntimeEventLog(input.turnId, input.sessionId).appendUnless(
      runtimeEvent(DONE_CHECK_BOUNCED_EVENT, {
        openSteps: open.map((step) => step.id),
      }),
      [DONE_CHECK_BOUNCED_EVENT],
    );
  // Nothing left but steps the plan has not caught up with: the reply must
  // not call them still to do.
  if (!open.length)
    return (await claim())
      ? `${done}\n${saved}Call update_plan (revision ${found.plan.revision}) to mark them done, then reply without calling any of them still to do.`
      : null;
  const onOwner = asksOwner(input.draft) || (await ownerBlocker(input.turnId));
  // Waiting on the owner with one step left: the answer is what that step
  // needs, so the question goes to them now. With more, the rest may not.
  if (onOwner && open.length === 1) return null;
  if (!(await claim())) return null;
  const known = `${done ? `${done}\n` : ""}${saved}`;
  if (onOwner)
    return `You are waiting on the owner, and your plan still lists open steps:\n${stepList(open)}\n${known}Call update_plan (revision ${found.plan.revision}) and mark each step that needs their answer blocked, with blockedOn owner and the question as its reason. Do the steps that do not need it now. Then reply, asking your question again.`;
  return `Your plan still lists open steps:\n${stepList(open)}\n${known}Do what you can of the rest now. A step that waits on someone: call update_plan (revision ${found.plan.revision}) and mark it blocked, with blockedOn and a reason; one no longer needed: skipped, with a reason. Then reply.`;
}
