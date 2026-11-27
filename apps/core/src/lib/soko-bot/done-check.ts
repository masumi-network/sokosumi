import { SOKO_BOT_TOOL_REFUSED } from "@sokosumi/soko-bot";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import { STUDIO_JOB_CAPABILITIES } from "@/lib/soko-bot/action-receipts";
import { parseActionNarrativeText } from "@/lib/soko-bot/action-response";
import { isOwnerRequest, ownerAskedIn } from "@/lib/soko-bot/owner-request";
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

/** Recorded before the one CMO unapplied-strategy-change bounce on a turn. */
export const CMO_UPCOMING_POSTS_BOUNCED_EVENT =
  "done_check.cmo_upcoming_posts_bounced";

/** Tools that activate the done check on CMO turns with `cmoApplyChanges`. */
export const CMO_APPLY_CHANGE_TRIGGER_TOOLS: ReadonlySet<string> = new Set([
  "write_strategy",
  "save_strategy",
]);

const CMO_SOCIAL_POST_MUTATION_CAPABILITIES = [
  "create_social_post",
  "update_social_post",
  "update_social_posts",
  "schedule_social_post",
  "cancel_social_post",
] as const;

const CMO_UPCOMING_UNPUBLISHED_STATUSES = [
  "DRAFT",
  "NEEDS_APPROVAL",
  "SCHEDULED",
] as const;

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

const OWNER_TURN = {
  sokoBotId: true,
  versionId: true,
  source: true,
  chainDepth: true,
  askedByUserId: true,
  requestedByUserId: true,
  parentTurnId: true,
  sokoBot: {
    select: {
      projectId: true,
    },
  },
  parentTurn: {
    select: {
      source: true,
      chainDepth: true,
      askedByUserId: true,
      requestedByUserId: true,
    },
  },
} as const;

async function turnPlan(turnId: string) {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: OWNER_TURN,
  });
  if (!turn || !(await resolveSokoBotVersion(turn.versionId)).planLoop)
    return null;
  const requestId = await resolveRequestId(turnId);
  const plan = await readRequestPlan(turn.sokoBotId, requestId);
  return plan ? { turn, requestId, plan } : null;
}

/**
 * The turn is the owner's own request, or a Core wake (a hand-over's
 * follow-up, a watch) that belongs to one: its request's first turn was
 * the owner's. A wake of Core's own, or one on a teammate's request, is not.
 */
async function ownerRequest(
  turnId: string,
  found: NonNullable<Awaited<ReturnType<typeof turnPlan>>>,
): Promise<boolean> {
  if (isOwnerRequest(found.turn, { schedules: true })) return true;
  if (found.turn.source !== "EVENT" || found.requestId === turnId) return false;
  const first = await prisma.sokoBotTurn.findUnique({
    where: { id: found.requestId },
    select: OWNER_TURN,
  });
  return (
    first?.sokoBotId === found.turn.sokoBotId &&
    isOwnerRequest(first, { schedules: true })
  );
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
        in: [...changeTools()],
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
 * CMO `cmoApplyChanges` check: on a foreground chat turn where Cuso saved a
 * new unapproved strategy version for a project that already has an approved
 * running month and upcoming unpublished posts, bounce once if no upcoming
 * posts have been updated yet (and nothing is in flight or blocked).
 */
async function checkCmoUnappliedStrategyChange(input: {
  turn: {
    sokoBotId: string;
    source: string | null;
    chainDepth: number;
    askedByUserId: string | null;
    requestedByUserId: string | null;
    parentTurnId: string | null;
    sokoBot?: { projectId: string | null } | null;
  };
  turnId: string;
  sessionId: string;
}): Promise<string | null> {
  const projectId = input.turn.sokoBot?.projectId ?? null;
  if (
    !projectId ||
    input.turn.source !== "CHAT" ||
    input.turn.parentTurnId !== null ||
    !ownerAskedIn(input.turn)
  ) {
    return null;
  }
  const requestId = await resolveRequestId(input.turnId);
  const turnIds = await requestTurnIds(
    input.turn.sokoBotId,
    requestId,
    input.turnId,
  );
  const [pending, approved] = await Promise.all([
    prisma.marketingStrategy.findFirst({
      where: {
        projectId,
        authorTurnId: { in: turnIds },
        approvedAt: null,
      },
      select: { id: true },
    }),
    prisma.marketingStrategy.findFirst({
      where: {
        projectId,
        approvedAt: { not: null },
      },
      select: { id: true },
    }),
  ]);
  if (!pending || !approved) return null;

  const [waiting, blocked, postWrite, upcomingCount] = await Promise.all([
    waitingOnOthers(input.turnId, turnIds),
    ownerBlocker(input.turnId),
    prisma.sokoBotToolCall.findFirst({
      where: {
        turnId: { in: turnIds },
        status: "COMPLETED",
        capability: { in: [...CMO_SOCIAL_POST_MUTATION_CAPABILITIES] },
        OR: [{ disposition: null }, { disposition: { not: "REJECTED" } }],
      },
      select: { id: true },
    }),
    prisma.socialPost.count({
      where: {
        projectId,
        canceledAt: null,
        publishedAt: null,
        status: { in: [...CMO_UPCOMING_UNPUBLISHED_STATUSES] },
      },
    }),
  ]);
  if (waiting || blocked || postWrite || upcomingCount === 0) return null;

  const claimed = await new RuntimeEventLog(
    input.turnId,
    input.sessionId,
  ).appendUnless(
    runtimeEvent(CMO_UPCOMING_POSTS_BOUNCED_EVENT, {
      projectId,
      strategyVersionId: pending.id,
      upcomingCount,
    }),
    [CMO_UPCOMING_POSTS_BOUNCED_EVENT],
  );
  if (!claimed) return null;

  const postWord = upcomingCount === 1 ? "post" : "posts";
  return `This turn saved a new unapproved strategy version, so none of the running month's posts changed yet, and this project currently has ${upcomingCount} upcoming unpublished social ${postWord}. Before finishing, inspect the upcoming posts with list_social_posts and apply the requested change to every affected post (update_social_post, update_social_posts, create_social_post, schedule_social_post, or cancel_social_post), then report what actually changed from receipts. If none of the upcoming posts are affected, confirm that from the live list and state plainly that the new strategy version still waits for approval.`;
}

/**
 * The done check (planLoop + optional CMO `cmoApplyChanges`): a foreground
 * owner turn about to answer while its plan still lists steps to do is sent
 * back once to do them or to mark them blocked or skipped. A turn that waits
 * on the owner is asked to mark what needs their answer blocked and to do the
 * rest, so a question about one step does not leave the others undone. When
 * `cmoApplyChanges` is enabled on a CMO version and no plan step bounced, Core
 * also checks whether an unapproved strategy save left upcoming posts on an
 * approved running month untouched.
 */
export async function evaluateTurnDoneCheck(input: {
  turnId: string;
  sessionId: string;
  draft: string;
}): Promise<string | null> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: input.turnId },
    select: OWNER_TURN,
  });
  if (!turn) return null;
  const version = await resolveSokoBotVersion(turn.versionId);

  if (version.planLoop) {
    const requestId = await resolveRequestId(input.turnId);
    const plan = await readRequestPlan(turn.sokoBotId, requestId);
    const found = plan ? { turn, requestId, plan } : null;
    if (
      found &&
      (await ownerRequest(input.turnId, found)) &&
      openSteps(found.plan).length
    ) {
      const turnIds = await requestTurnIds(
        found.turn.sokoBotId,
        found.requestId,
        input.turnId,
      );
      const open = openSteps(found.plan);
      const working = open.some((step) => step.status === "in_progress");
      if (working || !(await waitingOnOthers(input.turnId, turnIds))) {
        const onOwner =
          asksOwner(input.draft) || (await ownerBlocker(input.turnId));
        // Waiting on the owner with one step left: the answer is what that step
        // needs, so the question goes to them now. With more, the rest may not.
        if (!(onOwner && open.length === 1)) {
          const saves = await savesSince(found, turnIds);
          const claimed = await new RuntimeEventLog(
            input.turnId,
            input.sessionId,
          ).appendUnless(
            runtimeEvent(DONE_CHECK_BOUNCED_EVENT, {
              openSteps: open.map((step) => step.id),
            }),
            [DONE_CHECK_BOUNCED_EVENT],
          );
          if (claimed) {
            const known = savedNote(saves, found.plan.revision);
            if (onOwner)
              return `You are waiting on the owner, and your plan still lists open steps:\n${stepList(open, saves)}\n${known}Call update_plan (revision ${found.plan.revision}) and mark each step that needs their answer blocked, with blockedOn owner and the question as its reason. Do the steps that do not need it now. Then reply, asking your question again.`;
            return `Your plan still lists open steps:\n${stepList(open, saves)}\n${known}Do what you can of the rest now. A step that waits on someone: call update_plan (revision ${found.plan.revision}) and mark it blocked, with blockedOn and a reason; one no longer needed: skipped, with a reason. Then reply.`;
          }
        }
      }
    }
  }

  if (version.cmoApplyChanges && version.profile === "cmo") {
    return checkCmoUnappliedStrategyChange({
      turn,
      turnId: input.turnId,
      sessionId: input.sessionId,
    });
  }

  return null;
}
