import { SOKO_BOT_TOOL_REFUSED } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
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
  return `Open steps in your plan (revision ${found.plan.revision}):\n${stepList(open)}`;
}

/**
 * The request still waits on someone else: a hand-over whose follow-up has
 * not come back, a watch, or a background run. Pushing the bot on would only
 * make it poll.
 */
async function waitingOnOthers(
  turnId: string,
  requestId: string,
): Promise<boolean> {
  const turnIds = [...new Set([turnId, requestId])];
  const [delegation, watch, run] = await Promise.all([
    prisma.sokoBotDelegation.findFirst({
      where: {
        turnId: { in: turnIds },
        followUp: { not: null },
        followUpTurnId: null,
      },
      select: { id: true },
    }),
    prisma.sokoBotWatch.findFirst({
      where: { turnId: { in: turnIds }, status: "WAITING" },
      select: { id: true },
    }),
    prisma.sokoBotTurn.findFirst({
      where: {
        parentTurnId: { in: turnIds },
        id: { not: turnId },
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(delegation || watch || run);
}

/** The turn already stopped on the owner: a decision asked, or a refusal. */
async function waitingOnOwner(turnId: string, draft: string): Promise<boolean> {
  const narrative = parseActionNarrativeText(draft);
  if (
    narrative
      ? narrative.kind === "CLARIFY" || narrative.question
      : /\?\s*$/.test(draft.trim())
  )
    return true;
  const [decision, refusal] = await Promise.all([
    prisma.sokoBotPendingDecision.findFirst({
      where: { turnId },
      select: { id: true },
    }),
    prisma.sokoBotToolCall.findFirst({
      where: { turnId, errorKind: SOKO_BOT_TOOL_REFUSED },
      select: { id: true },
    }),
  ]);
  return Boolean(decision || refusal);
}

/**
 * The done check (planLoop): a foreground owner turn about to answer while
 * its plan still lists steps to do is sent back once to do them or to mark
 * them blocked or skipped. Null lets the answer through: no plan, nothing
 * open, the turn waits on the owner or on others, or it already bounced.
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
  if (!working && (await waitingOnOthers(input.turnId, found.requestId)))
    return null;
  if (await waitingOnOwner(input.turnId, input.draft)) return null;
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
  return `Your plan still lists open steps:\n${stepList(open)}\nDo what you can of them now. A step that waits on someone: call update_plan (revision ${found.plan.revision}) and mark it blocked, with blockedOn and a reason; one no longer needed: skipped, with a reason. Then reply.`;
}
