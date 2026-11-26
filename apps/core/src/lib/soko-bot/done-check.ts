import { SOKO_BOT_TOOL_REFUSED } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { ACTION_CAPABILITIES } from "@/lib/soko-bot/action-receipts";
import { parseActionNarrativeText } from "@/lib/soko-bot/action-response";
import { isOwnerRequest } from "@/lib/soko-bot/owner-request";
import {
  type ChainPlan,
  type PlanStep,
  readRequestPlan,
  resolveRequestId,
} from "@/lib/soko-bot/request-chain";
import { RuntimeEventLog, runtimeEvent } from "@/lib/soko-bot/turn-loop";
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
  const open = found ? openSteps(found.plan) : [];
  if (!found || !open.length) return null;
  const saves = await savesSincePlan(
    found.turn.sokoBotId,
    found.requestId,
    found.plan,
    await requestTurnIds(found.turn.sokoBotId, found.requestId, turnId),
  );
  const saved = savedNote(saves, found.plan.revision).trim();
  return `Open steps in your plan (revision ${found.plan.revision}):\n${stepList(open)}${saved ? `\n${saved}` : ""}`;
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

/**
 * What the request saved after its plan's newest revision, from Core's own
 * receipts: the plan's text may not show those steps as done yet, and the
 * bot must not be told, or tell the owner, that they are still to do.
 */
async function savesSincePlan(
  sokoBotId: string,
  requestId: string,
  plan: ChainPlan,
  turnIds: readonly string[],
): Promise<string[]> {
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
  const saves = await prisma.sokoBotToolCall.findMany({
    where: {
      turnId: { in: [...turnIds] },
      status: "COMPLETED",
      capability: { in: [...ACTION_CAPABILITIES] },
      createdAt: { gt: written.createdAt },
    },
    orderBy: { createdAt: "asc" },
    select: { capability: true },
    take: 20,
  });
  return [...new Set(saves.map((save) => save.capability))];
}

/** The saves the plan does not show yet, and what to do about them. */
function savedNote(saves: readonly string[], revision: number): string {
  return saves.length
    ? `Since your plan's revision ${revision} you completed: ${saves.join(", ")}. Core has the receipts, so the steps they did are done: mark them done with update_plan (revision ${revision}) and do not do them again. `
    : "";
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
  const open = openSteps(found.plan);
  if (!open.length) return null;
  const working = open.some((step) => step.status === "in_progress");
  const turnIds = await requestTurnIds(
    found.turn.sokoBotId,
    found.requestId,
    input.turnId,
  );
  if (!working && (await waitingOnOthers(input.turnId, turnIds))) return null;
  const saved = savedNote(
    await savesSincePlan(
      found.turn.sokoBotId,
      found.requestId,
      found.plan,
      turnIds,
    ),
    found.plan.revision,
  );
  const onOwner = asksOwner(input.draft) || (await ownerBlocker(input.turnId));
  const claimed = await new RuntimeEventLog(
    input.turnId,
    input.sessionId,
  ).appendUnless(
    runtimeEvent(DONE_CHECK_BOUNCED_EVENT, {
      openSteps: open.map((step) => step.id),
    }),
    [DONE_CHECK_BOUNCED_EVENT],
  );
  if (!claimed) return null;
  if (onOwner)
    return `You are waiting on the owner, and your plan still lists open steps:\n${stepList(open)}\n${saved}Call update_plan (revision ${found.plan.revision}) and mark each step that needs their answer blocked, with blockedOn owner and the question as its reason. Do the steps that do not need it now. Then reply, asking your question again.`;
  return `Your plan still lists open steps:\n${stepList(open)}\n${saved}Do what you can of the rest now. A step that waits on someone: call update_plan (revision ${found.plan.revision}) and mark it blocked, with blockedOn and a reason; one no longer needed: skipped, with a reason. Then reply.`;
}
