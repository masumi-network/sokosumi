import { SOKO_BOT_TOOL_REFUSED } from "@sokosumi/soko-bot";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import {
  isExternalEffectToolCall,
  STUDIO_JOB_CAPABILITIES,
} from "@/lib/soko-bot/action-receipts";
import { parseActionNarrativeText } from "@/lib/soko-bot/action-response";
import {
  buildCompletionBouncePrompt,
  COMPLETION_DECIDER_EVENT,
  type CompletionDeciderContext,
  type CompletionReadSummary,
  type CompletionReceiptSummary,
  type CompletionRefusalSummary,
  decideCompletionWithJev,
  receiptToRuntimeEventData,
} from "@/lib/soko-bot/completion-decider";
import { isOwnerRequest } from "@/lib/soko-bot/owner-request";
import {
  type ChainPlan,
  type PlanStep,
  readRequestPlan,
  resolveRequestId,
} from "@/lib/soko-bot/request-chain";
import {
  changeTools,
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

/**
 * The open steps, each beside the confirmed saves of a file it names. Core
 * never closes a step by name: a saved file proves the save, not that it
 * was attached, sent or finished, so the bot decides what the step needed.
 */
function stepList(
  steps: readonly PlanStep[],
  saves: readonly SaveReceipt[] = [],
): string {
  const done = saves.filter((save) => save.outcome === "done");
  return steps
    .map((step) => {
      const files = [
        ...new Set(
          done.flatMap((save) =>
            save.names.filter((name) => names(step, name)),
          ),
        ),
      ];
      return `- ${step.id} [${step.status}] ${step.step}${
        files.length
          ? ` (Core saved ${files.join(", ")}: that proves the save only)`
          : ""
      }`;
    })
    .join("\n");
}

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
  const saves = await savesSince(
    found,
    await requestTurnIds(found.turn.sokoBotId, found.requestId, turnId),
  );
  return [
    `Open steps in your plan (revision ${found.plan.revision}):\n${stepList(openSteps(found.plan), saves)}`,
    savedNote(saves, found.plan.revision).trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

function savesSince(
  found: NonNullable<Awaited<ReturnType<typeof turnPlan>>>,
  turnIds: readonly string[],
) {
  return savesSincePlan(
    found.turn.sokoBotId,
    found.requestId,
    found.plan,
    turnIds,
  );
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

/** "Minutes.md" is named "minutes.md". */
function receiptNames(result: unknown): string[] {
  const name = artifactName(result)?.toLowerCase().trim();
  return name && name.length >= 3 ? [name] : [];
}

const FILE_NAME = /[\w-]+(?:\.[\w-]+)*\.[a-z0-9]{1,5}\b/gi;

function namesIn(text: string): string[] {
  return (text.toLowerCase().match(FILE_NAME) ?? []).map((name) =>
    name.replace(/\.$/, ""),
  );
}

/** The step names this file: as a whole file token, not a shared word. */
function names(step: PlanStep, name: string): boolean {
  return name.includes(" ")
    ? step.step.toLowerCase().includes(name)
    : namesIn(step.step).includes(name);
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
  status?: string;
  disposition: string | null;
  targetId: string | null;
  result: unknown;
}): Promise<ReceiptOutcome> {
  if (call.disposition === "REJECTED") return "not done";
  if (call.disposition === "UNKNOWN") return "unconfirmed";
  if (call.status === "FAILED") return "not done";
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
  includeFailed = false,
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
      status: includeFailed ? { in: ["COMPLETED", "FAILED"] } : "COMPLETED",
      capability: {
        in: [...changeTools()],
      },
      createdAt: { gt: written.createdAt },
    },
    orderBy: { createdAt: "asc" },
    select: {
      capability: true,
      status: true,
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
  return `Since your plan's revision ${revision}, Core's receipts show:\n${lines}\nA step these saves finished is done: mark it done with update_plan (revision ${revision}), do not do it again, and never call it still to do. A saved file proves only that it was saved: a step that also needs it attached, sent or used is done only once that is done too. A step whose save did not happen is still open: do it again if you can, or mark it blocked with the reason. One whose work only started is under way: do not start it again; wait for it (follow what its tool said) and keep its step in progress until it finishes. One Core could not confirm may have happened: read back whether it did before anything else, never repeat it blind, and if you cannot tell, mark it blocked with the reason and say so.\n`;
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
 * Core write receipts, read summaries, and unresolved refusals across all
 * turns of a request, for the Jev completion decider (experiment E3).
 */
async function completionEvidence(
  turnId: string,
  turnIds: readonly string[],
): Promise<{
  receipts: CompletionReceiptSummary[];
  readCalls: CompletionReadSummary[];
  pendingDecisionCount: number;
  unresolvedRefusals: CompletionRefusalSummary[];
}> {
  const writes = changeTools();
  const [rawCalls, pendingDecisionCount] = await Promise.all([
    prisma.sokoBotToolCall.findMany({
      where: {
        turnId: { in: [...turnIds] },
        status: { in: ["COMPLETED", "FAILED"] },
      },
      // Read the newest calls so long chains never drop recent writes or refusals.
      orderBy: { createdAt: "desc" },
      select: {
        turnId: true,
        capability: true,
        input: true,
        status: true,
        disposition: true,
        targetId: true,
        result: true,
        errorKind: true,
        errorDetail: true,
      },
      take: 100,
    }),
    prisma.sokoBotPendingDecision.count({
      where: { turnId, status: "PENDING" },
    }),
  ]);
  const calls = [...rawCalls].reverse();

  const isChangeCall = (call: (typeof calls)[number]) =>
    writes.has(call.capability) ||
    call.disposition === "UNKNOWN" ||
    isExternalEffectToolCall(call.capability, call.input);

  const writeCalls = calls.filter(isChangeCall);
  const receipts: CompletionReceiptSummary[] = await Promise.all(
    writeCalls.slice(-20).map(async (call) => ({
      capability: call.capability,
      label: receiptLabel(call.targetId, call.result),
      outcome: await receiptOutcome(call),
      errorKind: call.errorKind,
      errorDetail: call.errorDetail,
    })),
  );

  const readsByCap = new Map<string, CompletionReadSummary>();
  for (const call of calls) {
    if (isChangeCall(call) || call.capability === "update_plan") continue;
    const entry = readsByCap.get(call.capability) ?? {
      capability: call.capability,
      completedCount: 0,
      failedCount: 0,
    };
    if (call.status === "COMPLETED") entry.completedCount += 1;
    else entry.failedCount += 1;
    readsByCap.set(call.capability, entry);
  }

  const turnCalls = calls.filter((call) => call.turnId === turnId);
  const unresolvedRefusals: CompletionRefusalSummary[] = [];
  for (let index = 0; index < turnCalls.length; index++) {
    const call = turnCalls[index];
    if (!call || call.errorKind !== SOKO_BOT_TOOL_REFUSED) continue;
    const madeGood = turnCalls
      .slice(index + 1)
      .some(
        (later) =>
          later.capability === call.capability &&
          later.status === "COMPLETED" &&
          later.disposition !== "REJECTED" &&
          later.disposition !== "UNKNOWN",
      );
    if (!madeGood) {
      unresolvedRefusals.push({
        capability: call.capability,
        errorDetail: call.errorDetail,
      });
    }
  }

  return {
    receipts,
    readCalls: [...readsByCap.values()],
    pendingDecisionCount,
    unresolvedRefusals,
  };
}

/**
 * Turns eligible for the Jev completion decider: direct owner chat/schedule
 * requests, plus owner-originated delegation/watch follow-up wakes. Built-in
 * rhythms (requestedByUserId === null) and autonomous/teammate turns stay out.
 */
async function completionTurnEligibility(
  turn: {
    id: string;
    sokoBotId: string;
    source: string;
    chainDepth: number;
    askedByUserId: string | null;
    requestedByUserId: string | null;
    parentTurnId: string | null;
    parentTurn: {
      source: string;
      chainDepth: number;
      askedByUserId: string | null;
      requestedByUserId: string | null;
    } | null;
  },
  requestId: string,
): Promise<{
  eligible: boolean;
  isFollowUpWake: boolean;
  rootRequest: string | null;
}> {
  if (
    turn.requestedByUserId !== null &&
    isOwnerRequest(turn, { schedules: true })
  ) {
    return { eligible: true, isFollowUpWake: false, rootRequest: null };
  }
  if (
    turn.source === "EVENT" &&
    turn.parentTurnId === null &&
    requestId !== turn.id
  ) {
    const root = await prisma.sokoBotTurn.findUnique({
      where: { id: requestId },
      select: {
        sokoBotId: true,
        source: true,
        chainDepth: true,
        askedByUserId: true,
        requestedByUserId: true,
        parentTurnId: true,
        userMessage: true,
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
    if (
      root &&
      root.sokoBotId === turn.sokoBotId &&
      root.requestedByUserId !== null &&
      isOwnerRequest(root, { schedules: true })
    ) {
      return {
        eligible: true,
        isFollowUpWake: true,
        rootRequest: root.userMessage,
      };
    }
  }
  return { eligible: false, isFollowUpWake: false, rootRequest: null };
}

async function runPlanLoopDoneCheck(input: {
  turnId: string;
  sessionId: string;
  draft: string;
  sokoBotId: string;
  requestId: string;
  plan: ChainPlan;
  turnIds: readonly string[];
}): Promise<string | null> {
  const open = openSteps(input.plan);
  if (!open.length) return null;
  const working = open.some((step) => step.status === "in_progress");
  if (!working && (await waitingOnOthers(input.turnId, input.turnIds)))
    return null;
  const onOwner = asksOwner(input.draft) || (await ownerBlocker(input.turnId));
  // Waiting on the owner with one step left: the answer is what that step
  // needs, so the question goes to them now. With more, the rest may not.
  if (onOwner && open.length === 1) return null;
  const saves = await savesSincePlan(
    input.sokoBotId,
    input.requestId,
    input.plan,
    input.turnIds,
  );
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
  const known = savedNote(saves, input.plan.revision);
  if (onOwner)
    return `You are waiting on the owner, and your plan still lists open steps:\n${stepList(open, saves)}\n${known}Call update_plan (revision ${input.plan.revision}) and mark each step that needs their answer blocked, with blockedOn owner and the question as its reason. Do the steps that do not need it now. Then reply, asking your question again.`;
  return `Your plan still lists open steps:\n${stepList(open, saves)}\n${known}Do what you can of the rest now. A step that waits on someone: call update_plan (revision ${input.plan.revision}) and mark it blocked, with blockedOn and a reason; one no longer needed: skipped, with a reason. Then reply.`;
}

/**
 * The done check (planLoop + optional E3 Jev completion decider):
 * - planLoop only (#8340): a foreground owner turn about to answer while its
 *   plan still lists steps to do is sent back once.
 * - completionDecider (E3): Jev chooses finish / continue / ask_owner from
 *   Core receipts, the plan (if any), and the draft, with host pre-filtering,
 *   stale re-check, structured decision receipts, and fallback to planLoop or
 *   finish. Works standalone or combined with planLoop.
 */
export async function evaluateTurnDoneCheck(input: {
  turnId: string;
  sessionId: string;
  draft: string;
}): Promise<string | null> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: input.turnId },
    select: {
      id: true,
      sokoBotId: true,
      versionId: true,
      source: true,
      chainDepth: true,
      askedByUserId: true,
      requestedByUserId: true,
      parentTurnId: true,
      userMessage: true,
      capabilityNames: true,
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
  if (!turn) return null;
  const version = await resolveSokoBotVersion(turn.versionId);

  if (!version.completionDecider) {
    if (!version.planLoop || !isOwnerRequest(turn, { schedules: true }))
      return null;
    const requestId = await resolveRequestId(input.turnId);
    const plan = await readRequestPlan(turn.sokoBotId, requestId);
    if (!plan || !openSteps(plan).length) return null;
    const turnIds = await requestTurnIds(
      turn.sokoBotId,
      requestId,
      input.turnId,
    );
    return runPlanLoopDoneCheck({
      turnId: input.turnId,
      sessionId: input.sessionId,
      draft: input.draft,
      sokoBotId: turn.sokoBotId,
      requestId,
      plan,
      turnIds,
    });
  }

  const requestId = await resolveRequestId(input.turnId);
  const eligibility = await completionTurnEligibility(turn, requestId);
  if (!eligibility.eligible) return null;

  const hasPlanLoop = version.planLoop === true;
  const [plan, turnIds, bouncedEvent] = await Promise.all([
    hasPlanLoop
      ? readRequestPlan(turn.sokoBotId, requestId)
      : Promise.resolve(null),
    requestTurnIds(turn.sokoBotId, requestId, input.turnId),
    prisma.sokoBotRuntimeEvent.findFirst({
      where: { turnId: input.turnId, type: DONE_CHECK_BOUNCED_EVENT },
      select: { id: true },
    }),
  ]);
  const open = plan ? openSteps(plan) : [];
  const [waiting, evidence] = await Promise.all([
    waitingOnOthers(input.turnId, turnIds),
    completionEvidence(input.turnId, turnIds),
  ]);

  const writes = changeTools();
  const availableWriteTools = turn.capabilityNames.filter((name) =>
    writes.has(name),
  );
  const availableReadToolCount = turn.capabilityNames.filter(
    (name) => !writes.has(name) && name !== "update_plan",
  ).length;

  const ctx: CompletionDeciderContext = {
    request: turn.userMessage,
    rootRequest: eligibility.rootRequest,
    isFollowUpWake: eligibility.isFollowUpWake,
    turnSource: turn.source,
    draft: input.draft,
    plan,
    openSteps: open,
    receipts: evidence.receipts,
    readCalls: evidence.readCalls,
    pendingDecisionCount: evidence.pendingDecisionCount,
    unresolvedRefusals: evidence.unresolvedRefusals,
    waitingOnOthers: waiting,
    availableWriteTools,
    availableReadToolCount,
    alreadyBounced: bouncedEvent !== null,
    hasPlanLoop,
  };

  let recheckedPlan: ChainPlan | null = plan;
  const decision = await decideCompletionWithJev(ctx, {
    recheckState: async () => {
      const [freshBounce, freshWaiting, freshPlan] = await Promise.all([
        prisma.sokoBotRuntimeEvent.findFirst({
          where: { turnId: input.turnId, type: DONE_CHECK_BOUNCED_EVENT },
          select: { id: true },
        }),
        waitingOnOthers(input.turnId, turnIds),
        hasPlanLoop
          ? readRequestPlan(turn.sokoBotId, requestId)
          : Promise.resolve(null),
      ]);
      recheckedPlan = freshPlan;
      const freshOpen = freshPlan ? openSteps(freshPlan) : null;
      return {
        alreadyBounced: freshBounce !== null,
        waitingOnOthers: freshWaiting,
        openStepIds: freshOpen ? freshOpen.map((step) => step.id) : null,
        hasInProgressStep:
          freshOpen?.some((step) => step.status === "in_progress") ?? false,
        hasTools: turn.capabilityNames.length > 0,
      };
    },
  });

  const log = new RuntimeEventLog(input.turnId, input.sessionId);
  const recordReceipt = async (receipt = decision.receipt) => {
    if (
      receipt.validation === "skipped_prefilter" &&
      receipt.validationDetail === "already_bounced"
    )
      return;
    await log
      .append(
        runtimeEvent(
          COMPLETION_DECIDER_EVENT,
          receiptToRuntimeEventData(receipt),
        ),
      )
      .catch(() => undefined);
  };

  if (decision.usePlanLoopFallback && hasPlanLoop) {
    const freshPlan =
      recheckedPlan ??
      (await readRequestPlan(turn.sokoBotId, requestId)) ??
      plan;
    const prompt = freshPlan
      ? await runPlanLoopDoneCheck({
          turnId: input.turnId,
          sessionId: input.sessionId,
          draft: input.draft,
          sokoBotId: turn.sokoBotId,
          requestId,
          plan: freshPlan,
          turnIds,
        })
      : null;
    await recordReceipt({
      ...decision.receipt,
      outcome: prompt ? "continue" : "finish",
      bounced: prompt !== null,
    });
    return prompt;
  }

  if (
    decision.action === "continue" ||
    decision.action === "ask_owner_bounce"
  ) {
    const effectivePlan = recheckedPlan ?? plan;
    const effectiveOpen = effectivePlan ? openSteps(effectivePlan) : open;
    const claimed = await log.appendUnless(
      runtimeEvent(DONE_CHECK_BOUNCED_EVENT, {
        openSteps: effectiveOpen.map((step) => step.id),
        source: "completion_decider",
        chosenTarget: decision.receipt.chosenTarget,
      }),
      [DONE_CHECK_BOUNCED_EVENT],
    );
    if (!claimed) {
      await recordReceipt({
        ...decision.receipt,
        validation: "stale",
        validationDetail: "bounce_claim_race",
        fallback: true,
        fallbackPolicy: "finish",
        outcome: "finish",
        bounced: false,
      });
      return null;
    }
    const saves = effectivePlan
      ? await savesSincePlan(
          turn.sokoBotId,
          requestId,
          effectivePlan,
          turnIds,
          true,
        )
      : [];
    const effectiveCtx: CompletionDeciderContext =
      effectivePlan === plan
        ? ctx
        : { ...ctx, plan: effectivePlan, openSteps: effectiveOpen };
    const prompt = buildCompletionBouncePrompt({
      ctx: effectiveCtx,
      decision,
      openStepsText: effectivePlan ? stepList(effectiveOpen, saves) : "",
      savedNoteText: effectivePlan
        ? savedNote(saves, effectivePlan.revision)
        : "",
    });
    await recordReceipt({
      ...decision.receipt,
      bounced: prompt !== null,
      outcome: prompt ? decision.receipt.outcome : "finish",
    });
    return prompt;
  }

  await recordReceipt();
  return null;
}
