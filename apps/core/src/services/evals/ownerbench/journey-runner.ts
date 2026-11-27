import type { SokoBotTurnStatus } from "@sokosumi/database";
import {
  evaluateScenario,
  type ScenarioCheck,
  type SokoBotJudgeVerdict,
} from "@sokosumi/soko-bot";
import { z } from "zod";
import { jsonInput } from "@/helpers/prisma-json";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { setEvalCoworkerScript } from "@/lib/evals/fake-coworker";
import { recordCoreWarning } from "@/lib/evlog";
import { localChatGptPlanEnabled } from "@/lib/local-chatgpt-plan";
import { planJevMode, planJevStandInDuring } from "@/lib/plan-jev";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { effectiveSokoBotRuntimeAdapter } from "@/lib/soko-bot/factory";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import {
  SOKO_EVENTS_SYNC_KEY,
  sokoBotEventsSyncService,
} from "@/services/soko-bot-events-sync.service";
import { judgeEvalChain } from "@/services/soko-bot-lab-judge.service";
import { startLabScenarioTurn } from "@/services/soko-bot-lab-scenario.service";
import { sokoBotSchedulesSyncService } from "@/services/soko-bot-schedules-sync.service";
import { syncSokoBotWatches } from "@/services/soko-bot-watches.service";
import { loadA2aChain } from "../eval-a2a";
import type {
  CaseContext,
  CaseOutcome,
  CasePoll,
  CaseStart,
} from "../eval-case-runner";
import { prepareCmoChatCase } from "../eval-cmo-runner";
import {
  clearEarlierCaseArtifacts,
  type EvalLaneRecord,
  resetEvalLaneForSokoBot,
} from "../eval-lanes.service";
import { coworkerTasks, outcomeCheck } from "./journey-checks";
import {
  freshCusoRoom,
  type JourneyWorld,
  prepareJourneyWorld,
} from "./journey-world";
import {
  type JourneyStep,
  journeyJudgeScenario,
  type OwnerJourney,
} from "./journeys";

/** A wait on a chat reply or an app nobody will connect ends after this much quiet. */
const QUIET_MS = 90_000;
const ACTIVE: SokoBotTurnStatus[] = [
  "QUEUED",
  "STARTING",
  "RUNNING",
  "CANCEL_REQUESTED",
];

export interface StepRecord {
  index: number;
  kind: JourneyStep["kind"];
  /** What started the step: the owner's message, or what happened. */
  label: string;
  startedAt: string;
  finishedAt?: string;
  turnIds: string[];
  checks: ScenarioCheck[];
  passed?: boolean;
  /** Why the step could not start or settle. */
  error?: string;
  answer?: string | null;
  tools?: string[];
  toolCalls?: number;
  toolErrors?: string[];
  retries?: number;
  costUsd?: number;
  durationMs?: number;
}

const stateSchema = z.object({
  world: z.custom<JourneyWorld>(),
  journeyStartedAt: z.string(),
  steps: z.array(z.custom<StepRecord>()),
  /** What one step's checks recorded for a later step's (the launch pieces). */
  memo: z.record(z.string(), z.array(z.string())).default({}),
});
type JourneyState = z.infer<typeof stateSchema>;

function botOf(journey: OwnerJourney, lane: EvalLaneRecord): string {
  return journey.bot === "cuso" ? lane.cusoBotId : lane.sokoBotId;
}

function stepLabel(step: JourneyStep): string {
  if (step.kind === "owner") return `Owner: ${step.message}`;
  if (step.kind === "teammate") return `${step.member}: ${step.message}`;
  if (step.kind === "coworker")
    return `${step.coworker} sets its Task ${step.status}: ${step.comment}`;
  return "The schedule fires";
}

async function reconcile(started: {
  turnId: string;
  reconciliationLeaseToken?: string | null;
}): Promise<string> {
  if (started.reconciliationLeaseToken)
    await sokoBotControlPlane
      .reconcileTurn(
        started.turnId,
        undefined,
        started.reconciliationLeaseToken,
      )
      .catch(() => undefined);
  return started.turnId;
}

/**
 * Starts one step: the turn it started, null when the product starts it later
 * (a Coworker's answer wakes the bot through the events sync), or why it
 * could not start.
 */
async function startStep(
  journey: OwnerJourney,
  index: number,
  lane: EvalLaneRecord,
  world: JourneyWorld,
  context: CaseContext,
  journeyStartedAt: Date,
  memo: JourneyState["memo"],
): Promise<string | null | { error: string }> {
  const step = journey.steps[index]!;
  const botId = botOf(journey, lane);
  const clientTurnId = `lab:eval:${context.resultId}:${index}`;
  if (step.kind === "owner") {
    if (journey.bot === "soko-bot")
      return startLabScenarioTurn(
        { ...journeyJudgeScenario(journey), prompt: step.message },
        {
          bot: { id: botId, userId: lane.userId },
          workspaceId: lane.workspaceId,
        },
        clientTurnId,
      );
    if (!world.cusoRoomId) return { error: "The journey has no Cuso room" };
    return askInRoom(world.cusoRoomId, lane.userId, botId, step.message);
  }
  if (step.kind === "teammate") {
    if (!world.teammateRoomId)
      return { error: "The journey has no teammate room" };
    const member =
      step.member === "Hannah"
        ? lane.world.hannahUserId
        : lane.world.alexUserId;
    return askInRoom(world.teammateRoomId, member, botId, step.message);
  }
  if (step.kind === "coworker") {
    const [task] = await coworkerTasks(
      { lane, world, journeyStartedAt, botId },
      world.coworkers[step.coworker],
    );
    if (!task) return { error: `No Task for ${step.coworker} to answer on` };
    await deliverCoworkerAnswer(task.id, world.coworkers[step.coworker], step);
    return null;
  }
  const schedule = await ownerSchedule(botId);
  if (!schedule) return { error: "No schedule to fire" };
  return fireSchedule(schedule.id, botId, memo);
}

/**
 * A member writes to the bot as the chat does: a message in a room that
 * mentions it, answered through the chat route's own dispatch (the owner in
 * Cuso's home room, a teammate in the room they share with the owner's bot).
 */
async function askInRoom(
  roomId: string,
  senderUserId: string,
  botId: string,
  content: string,
): Promise<string | { error: string }> {
  const message = await prisma.chatRoomMessage.create({
    data: {
      roomId,
      senderUserId,
      content,
      mentionsAsSource: { create: { sokoBotId: botId, coworkerId: null } },
    },
    select: { mentionsAsSource: { select: { id: true } } },
  });
  const [mention] = message.mentionsAsSource;
  if (!mention) return { error: "The message mentions nobody" };
  // Loaded here: the dispatch pulls in auth and Stripe, which every route
  // reaching the eval cases (the sync routes) would otherwise construct.
  const { dispatchChatRoomMention } = await import(
    "@/services/chat-room-coworker-dispatch.service"
  );
  await dispatchChatRoomMention(mention.id);
  const turn = await prisma.sokoBotTurn.findFirst({
    where: { chatMentionId: mention.id },
    select: { id: true },
  });
  return turn?.id ?? { error: "The mention started no turn" };
}

/** Runs a production sync with the lane's bot unpaused, as a live bot is. */
async function whileUnpaused<T>(
  botId: string,
  work: () => Promise<T>,
): Promise<T> {
  const { proactivePaused: paused } = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: botId },
    select: { proactivePaused: true },
  });
  await prisma.sokoBot.update({
    where: { id: botId },
    data: { proactivePaused: false },
  });
  try {
    return await work();
  } finally {
    await prisma.sokoBot.update({
      where: { id: botId },
      data: { proactivePaused: paused },
    });
  }
}

/**
 * Runs the schedule through the cron's own path, its claim scoped to this
 * schedule so no other schedule's due or recoverable run is touched, and
 * returns the turn of the run it claimed.
 */
async function fireSchedule(
  scheduleId: string,
  botId: string,
  memo: JourneyState["memo"],
): Promise<string | null | { error: string }> {
  await prisma.sokoBotSchedule.update({
    where: { id: scheduleId },
    data: { nextRunAt: new Date(0) },
  });
  const run = await claimScheduleRun(scheduleId, botId);
  if (!run) return { error: "The schedule sync claimed nothing" };
  // The step follows this run, not any scheduled turn of the bot.
  memo.scheduleRun = [scheduleId, run.id];
  if (FAILED_RUN.includes(run.status))
    return { error: `The scheduled run ended ${run.status}` };
  // A busy bot defers the run, as the cron does; the step's polls claim it
  // again (`stepSettled`) until its turn starts.
  return run.turnId;
}

/** Schedule run states that will never start the run's turn. */
const FAILED_RUN = ["FAILED", "DEAD_LETTER"];

/** One scoped schedule sync: the run it claimed, due or recovered, if any. */
async function claimScheduleRun(
  scheduleId: string,
  botId: string,
): Promise<{ id: string; turnId: string | null; status: string } | null> {
  let claims = 0;
  const leases: { turnId: string; leaseToken: string }[] = [];
  const synced = await whileUnpaused(botId, () =>
    sokoBotSchedulesSyncService.syncDueSchedules({
      scheduleId,
      shouldContinue: () => claims++ === 0,
      enqueueReconciliation: (lease) => leases.push(lease),
    }),
  );
  for (const lease of leases)
    await reconcile({
      turnId: lease.turnId,
      reconciliationLeaseToken: lease.leaseToken,
    });
  const [runId] = synced.runIds;
  return runId
    ? prisma.sokoBotScheduleRun.findUnique({
        where: { id: runId },
        select: { id: true, turnId: true, status: true },
      })
    : null;
}

/**
 * The run the step claimed: settled once its turn exists, or once it can
 * never start one (FAILED, DEAD_LETTER); otherwise claimed again, as the
 * next cron tick would.
 */
export async function claimedRunState(
  memo: JourneyState["memo"],
  botId: string,
): Promise<"started" | "failed" | "waiting"> {
  const [scheduleId, runId] = memo.scheduleRun ?? [];
  if (!scheduleId || !runId) return "failed";
  const run = await prisma.sokoBotScheduleRun.findUnique({
    where: { id: runId },
    select: { turnId: true, status: true },
  });
  if (!run || FAILED_RUN.includes(run.status)) return "failed";
  if (run.turnId) return "started";
  await claimScheduleRun(scheduleId, botId);
  return "waiting";
}

/** The run the step claimed started its turn and did not fail. */
export async function claimedRunCheck(
  memo: JourneyState["memo"],
): Promise<ScenarioCheck> {
  const [, runId] = memo.scheduleRun ?? [];
  const run = runId
    ? await prisma.sokoBotScheduleRun.findUnique({
        where: { id: runId },
        select: { turnId: true, status: true },
      })
    : null;
  return {
    label: "The claimed scheduled run ran",
    pass: Boolean(run?.turnId) && !FAILED_RUN.includes(run?.status ?? ""),
    actual: run
      ? `${run.status}${run.turnId ? "" : ", no turn"}`
      : "no run claimed",
  };
}

/** The schedule the owner had the bot make, newest first. */
function ownerSchedule(botId: string) {
  return prisma.sokoBotSchedule.findFirst({
    where: { sokoBotId: botId, systemKey: null, enabled: true },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * The Coworker answers on its Task the way a Coworker does: an event in its
 * name and the Task's new status. Nothing starts a turn here; the production
 * events sync wakes the bot (`wakeOnDelegatedWork`), so a missing wake is the
 * product's, not the benchmark's.
 */
async function deliverCoworkerAnswer(
  taskId: string,
  coworkerId: string,
  step: Extract<JourneyStep, { kind: "coworker" }>,
): Promise<void> {
  await prisma.$transaction([
    prisma.taskEvent.create({
      data: {
        taskId,
        status: step.status,
        comment: step.comment,
        coworkerId,
      },
    }),
    prisma.task.update({
      where: { id: taskId },
      data: { status: step.status },
    }),
  ]);
}

/** The events cron's scan, for this bot only; a busy bot is woken on a later poll. */
async function wakeOnDelegatedWork(botId: string): Promise<void> {
  await whileUnpaused(botId, () =>
    sokoBotEventsSyncService.syncDelegatedWork({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      sokoBotId: botId,
    }),
  );
}

/**
 * The step's own turns: this bot's turns since the step began that ran the
 * journey's version and whose request chain started in this journey. A watch
 * or follow-up that an earlier run left on the same bot can fire mid-step;
 * it is not this journey's work, so it is neither scored nor waited for.
 */
export async function journeyTurns(
  botId: string,
  since: Date,
  journeyStartedAt: Date,
) {
  const [bot, turns] = await Promise.all([
    prisma.sokoBot.findUnique({
      where: { id: botId },
      select: { versionId: true },
    }),
    prisma.sokoBotTurn.findMany({
      where: { sokoBotId: botId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        versionId: true,
        parentTurnId: true,
        source: true,
        status: true,
        updatedAt: true,
      },
    }),
  ]);
  const own: typeof turns = [];
  for (const turn of turns) {
    if (bot?.versionId && turn.versionId && turn.versionId !== bot.versionId)
      continue;
    if (await chainStartedBefore(turn.parentTurnId, journeyStartedAt)) continue;
    own.push(turn);
  }
  return own;
}

/** Whether a turn's chain of parents reaches a turn from before `start`. */
async function chainStartedBefore(
  parentId: string | null,
  start: Date,
): Promise<boolean> {
  const seen = new Set<string>();
  for (let id = parentId; id && !seen.has(id); ) {
    seen.add(id);
    const parent = await prisma.sokoBotTurn.findUnique({
      where: { id },
      select: { createdAt: true, parentTurnId: true },
    });
    if (!parent) return false;
    if (parent.createdAt < start) return true;
    id = parent.parentTurnId;
  }
  return false;
}

async function stepTurnIds(
  botId: string,
  since: Date,
  journeyStartedAt: Date,
): Promise<string[]> {
  return (await journeyTurns(botId, since, journeyStartedAt)).map(
    (turn) => turn.id,
  );
}

/**
 * Whether the step's turns, waits and follow-ups have all settled. A step
 * that waits on a wake runs the events scan each poll and settles only after
 * the bot was woken (or the step times out).
 */
async function stepSettled(
  botId: string,
  since: Date,
  journeyStartedAt: Date,
  now: Date,
  awaits: "wake" | "schedule" | null,
  memo: JourneyState["memo"],
): Promise<boolean> {
  if (awaits === "wake") {
    await wakeOnDelegatedWork(botId);
    const own = await journeyTurns(botId, since, journeyStartedAt);
    if (!own.some((turn) => turn.source === "EVENT")) return false;
  }
  if (awaits === "schedule") {
    const run = await claimedRunState(memo, botId);
    // A run that can never start ends the step now; finishStep says why.
    if (run === "failed") return true;
    if (run === "waiting") return false;
  }
  const own = await journeyTurns(botId, since, journeyStartedAt);
  if (own.some((turn) => ACTIVE.includes(turn.status))) return false;
  const last = own.reduce<{ updatedAt: Date } | null>(
    (latest, turn) =>
      !latest || turn.updatedAt > latest.updatedAt ? turn : latest,
    null,
  );
  // Nobody answers a chat question or connects an app in an eval lane.
  if (last && now.getTime() - last.updatedAt.getTime() > QUIET_MS)
    await prisma.sokoBotWatch.updateMany({
      where: {
        sokoBotId: botId,
        status: "WAITING",
        kind: { in: ["chat_reply", "app_connected"] },
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    });
  const sync = await syncSokoBotWatches({
    shouldContinue: () => true,
    sokoBotId: botId,
  });
  if (sync.fired > 0 || sync.deferred > 0) return false;
  const waiting = await prisma.sokoBotWatch.count({
    where: { sokoBotId: botId, status: "WAITING", createdAt: { gte: since } },
  });
  return waiting === 0;
}

/** Calls of a tool that come after a failed call of the same tool. */
export function countRetries(
  calls: readonly { capability: string; status: string }[],
): number {
  const failed = new Set<string>();
  let retries = 0;
  for (const call of calls) {
    if (failed.has(call.capability)) retries += 1;
    if (call.status === "FAILED") failed.add(call.capability);
  }
  return retries;
}

async function turnsCostUsd(turnIds: readonly string[]): Promise<number> {
  const turns = await prisma.sokoBotTurn.findMany({
    where: { id: { in: [...turnIds] } },
    select: { costUsdMicros: true, overheadCostUsdMicros: true },
  });
  return (
    turns.reduce(
      (sum, turn) =>
        sum +
        Number(turn.costUsdMicros ?? 0) +
        Number(turn.overheadCostUsdMicros),
      0,
    ) / 1e6
  );
}

async function journeyToolCalls(state: JourneyState, current: string[]) {
  const ids = [...state.steps.flatMap((step) => step.turnIds), ...current];
  return prisma.sokoBotToolCall.findMany({
    where: { turnId: { in: ids } },
    orderBy: { createdAt: "asc" },
    select: {
      capability: true,
      status: true,
      input: true,
      result: true,
      errorKind: true,
    },
  });
}

/**
 * The first turn's context holds no turn from before the journey: an earlier
 * case's launch or video in it measures the bench, not the bot.
 */
export async function freshConversationCheck(
  turnId: string,
  journeyStartedAt: Date,
): Promise<ScenarioCheck> {
  const snapshot = await prisma.sokoBotContextSnapshot.findUnique({
    where: { turnId },
    select: { packet: true },
  });
  const ids = packetTurnIds(snapshot?.packet);
  const foreign = await prisma.sokoBotTurn.count({
    where: { id: { in: ids }, createdAt: { lt: journeyStartedAt } },
  });
  // No snapshot is no evidence: it fails rather than passes as fresh.
  return {
    label: "Starts a fresh conversation",
    pass: Boolean(snapshot) && foreign === 0,
    actual: snapshot
      ? `${foreign} of ${ids.length} recent turn(s) from before the journey`
      : "no context snapshot",
  };
}

/**
 * The first turn's context holds no Task another case made: the Tasks it
 * carries that a bot created, or a bot's Task Schedule released, before this
 * journey started. A member's Task from before (the seeded board) is the
 * world, not a leak. No snapshot is no evidence.
 */
export async function earlierCaseTasksCheck(
  turnId: string,
  journeyStartedAt: Date,
): Promise<ScenarioCheck> {
  const snapshot = await prisma.sokoBotContextSnapshot.findUnique({
    where: { turnId },
    select: { packet: true },
  });
  const ids = packetTaskIds(snapshot?.packet);
  const foreign = await prisma.task.findMany({
    where: {
      id: { in: ids },
      createdAt: { lt: journeyStartedAt },
      OR: [
        { creatorSokoBotId: { not: null } },
        { schedule: { creatorSokoBotId: { not: null } } },
      ],
    },
    select: { name: true },
  });
  return {
    label: "Opens with no other case's Tasks",
    pass: Boolean(snapshot) && foreign.length === 0,
    actual: snapshot
      ? foreign.length
        ? `${foreign.length} of ${ids.length} Task(s) from another case: "${foreign[0]?.name}"`
        : `0 of ${ids.length} Task(s) from another case`
      : "no context snapshot",
  };
}

/** Tools whose results show what is in Files. */
const FILE_READS = [
  "list_files",
  "read_file",
  "search_files",
  "workspace_import_file",
];

/**
 * Neither the first turn's context nor what its file reads returned names a
 * file an earlier case left: a Drive upload of the lane made before this
 * journey's isolation point, by its id. Names repeat (this journey may
 * upload its own "evidence.pdf"), so a name never makes a file earlier.
 */
export async function earlierCaseFilesCheck(
  turnId: string,
  isolatedAt: Date,
  workspaceId: string,
  toolCalls: readonly { capability: string; result?: unknown }[],
): Promise<ScenarioCheck> {
  const snapshot = await prisma.sokoBotContextSnapshot.findUnique({
    where: { turnId },
    select: { packet: true },
  });
  const earlier = await prisma.fileResource.findMany({
    where: {
      workspaceId,
      sourceKind: "DRIVE_UPLOAD",
      createdAt: { lt: isolatedAt },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, displayName: true },
  });
  const seen = [
    JSON.stringify(snapshot?.packet ?? null),
    ...toolCalls
      .filter((call) => FILE_READS.includes(call.capability))
      .map((call) => JSON.stringify(call.result ?? null)),
  ].join("\n");
  const leaked = earlier.filter((file) => seen.includes(file.id));
  return {
    label: "Opens with no other case's files",
    pass: Boolean(snapshot) && leaked.length === 0,
    actual: snapshot
      ? leaked.length
        ? `${leaked.length} earlier case file(s) seen: "${leaked[0]?.displayName}"`
        : "no earlier case's file in the context or the first file reads"
      : "no context snapshot",
  };
}

/** The Task ids a context packet's tasks names. */
export function packetTaskIds(packet: unknown): string[] {
  const tasks =
    packet && typeof packet === "object" && "tasks" in packet
      ? (packet as { tasks: unknown }).tasks
      : null;
  return Array.isArray(tasks)
    ? tasks.flatMap((task) =>
        task && typeof task === "object" && "id" in task
          ? [String(task.id)]
          : [],
      )
    : [];
}

/** The turn ids a context packet's recentTurns names. */
export function packetTurnIds(packet: unknown): string[] {
  const recent =
    packet && typeof packet === "object" && "recentTurns" in packet
      ? (packet as { recentTurns: unknown }).recentTurns
      : null;
  return Array.isArray(recent)
    ? recent.flatMap((turn) =>
        turn && typeof turn === "object" && "id" in turn
          ? [String(turn.id)]
          : [],
      )
    : [];
}

/** Scores a settled step: its tools and answer, then the world it left. */
async function finishStep(
  journey: OwnerJourney,
  record: StepRecord,
  state: JourneyState,
  lane: EvalLaneRecord,
  now: Date,
): Promise<StepRecord> {
  const step = journey.steps[record.index]!;
  const turnIds = await stepTurnIds(
    botOf(journey, lane),
    new Date(record.startedAt),
    new Date(state.journeyStartedAt),
  );
  const checks: ScenarioCheck[] = [];
  let merged: Awaited<ReturnType<typeof loadA2aChain>>["merged"] | null = null;
  if (turnIds.length) {
    merged = (await loadA2aChain(turnIds)).merged;
    const result = evaluateScenario(
      {
        ...journeyJudgeScenario(journey),
        expect: { routes: [], ...step.expect },
      },
      merged,
    );
    checks.push(
      ...result.checks.filter((check) => !check.label.startsWith("Route ")),
    );
  } else checks.push({ label: "Completed", pass: false, actual: "no turn" });
  if (record.index === 0 && turnIds[0])
    checks.push(
      await freshConversationCheck(
        turnIds[0],
        new Date(state.journeyStartedAt),
      ),
      await earlierCaseTasksCheck(turnIds[0], new Date(state.journeyStartedAt)),
      await earlierCaseFilesCheck(
        turnIds[0],
        new Date(state.world.isolatedAt ?? state.journeyStartedAt),
        lane.workspaceId,
        merged?.toolCalls ?? [],
      ),
    );
  if (step.kind === "schedule_fires")
    checks.push(await claimedRunCheck(state.memo));
  if (step.kind === "coworker") {
    // The answer was delivered once and the scan ran twice: one wake is
    // right, none is a missing wake, more is a duplicate.
    const wakes = await prisma.sokoBotTurn.count({
      where: {
        sokoBotId: botOf(journey, lane),
        source: "EVENT",
        createdAt: { gte: new Date(record.startedAt) },
      },
    });
    checks.push({
      label: `Woken once by ${step.coworker}'s answer`,
      pass: wakes === 1,
      actual: `${wakes} wake(s)`,
    });
  }
  const toolCalls = await journeyToolCalls(state, turnIds);
  for (const outcome of step.outcomes ?? [])
    checks.push(
      await outcomeCheck(outcome, {
        lane,
        world: state.world,
        journey,
        journeyStartedAt: new Date(state.journeyStartedAt),
        stepStartedAt: new Date(record.startedAt),
        toolCalls,
        botId: botOf(journey, lane),
        answer: merged?.finalAnswer ?? null,
        memo: state.memo,
      }),
    );
  const calls = merged?.toolCalls ?? [];
  return {
    ...record,
    finishedAt: now.toISOString(),
    turnIds,
    checks,
    passed: checks.every((check) => check.pass),
    answer: merged?.finalAnswer ?? null,
    tools: calls.map(
      (call) =>
        `${call.capability}${call.status === "FAILED" ? " (failed)" : ""}`,
    ),
    toolCalls: calls.length,
    toolErrors: calls
      .filter((call) => call.status === "FAILED")
      .map((call) => call.capability),
    retries: countRetries(calls),
    costUsd: await turnsCostUsd(turnIds),
    durationMs: now.getTime() - new Date(record.startedAt).getTime(),
  };
}

function parseState(raw: unknown): JourneyState {
  return stateSchema.parse(raw);
}

async function saveState(resultId: string, state: JourneyState) {
  await prisma.evalResult.update({
    where: { id: resultId },
    data: { state: jsonInput(state) },
  });
}

async function beginStep(
  journey: OwnerJourney,
  index: number,
  lane: EvalLaneRecord,
  state: JourneyState,
  context: CaseContext,
): Promise<StepRecord> {
  const startedAt = await databaseNow();
  const record: StepRecord = {
    index,
    kind: journey.steps[index]!.kind,
    label: stepLabel(journey.steps[index]!),
    startedAt: startedAt.toISOString(),
    turnIds: [],
    checks: [],
  };
  const started = await startStep(
    journey,
    index,
    lane,
    state.world,
    context,
    new Date(state.journeyStartedAt),
    state.memo,
  ).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  if (started === null) return record;
  if (typeof started === "string") return { ...record, turnIds: [started] };
  return {
    ...record,
    finishedAt: startedAt.toISOString(),
    error: started.error,
    passed: false,
    checks: [{ label: "Step could start", pass: false, actual: started.error }],
  };
}

/**
 * Each journey is a new conversation: the bot's memory starts empty and its
 * earlier turns no longer count as the owner's, so they leave a personal
 * bot's recent turns (Cuso, a shared bot, gets a fresh room instead).
 */
async function forgetEarlierJourneys(lane: EvalLaneRecord, botId: string) {
  await sokoBotControlPlane.resetMemory(lane.userId, lane.workspaceId, {
    kind: "id",
    sokoBotId: botId,
  });
  // Every earlier turn of the lane's bot, not only the owner's own messages:
  // a schedule run or a Coworker wake from the last journey is history too.
  await prisma.sokoBotTurn.updateMany({
    where: { sokoBotId: botId, requestedByUserId: lane.userId },
    data: { requestedByUserId: null },
  });
}

/**
 * A journey whose lane still holds an earlier case's work the reset could
 * not remove ends before its first step as an infrastructure error, as a
 * failed route pick does: unscored, never a pass, a failure or a regression.
 */
export function isolationFailed(
  journey: OwnerJourney,
  blobsPending: readonly string[],
): CaseStart {
  return {
    kind: "done",
    outcome: {
      status: "ERROR",
      checks: [],
      output: { journey: journey.id, setup: { blobsPending } },
      error: `The lane was not cleaned: ${blobsPending.length} earlier upload blob(s) could not be deleted (${blobsPending.slice(0, 3).join(", ")}), so an earlier case's file may still be found; unscored until a reset deletes them`,
      turnIds: [],
    },
  };
}

export async function startJourney(
  journey: OwnerJourney,
  lane: EvalLaneRecord,
  context: CaseContext,
): Promise<CaseStart> {
  const botId = botOf(journey, lane);
  if (
    (await prisma.sokoBotTurn.count({
      where: { sokoBotId: botId, status: { in: ACTIVE } },
    })) > 0
  )
    return { kind: "busy" };
  // Cuso has no full reset: what earlier cases made goes before its setup
  // seeds this journey's world.
  const { blobsPending } =
    journey.bot === "soko-bot"
      ? await resetEvalLaneForSokoBot(lane)
      : await clearEarlierCaseArtifacts(lane);
  // An earlier case's file the reset could not delete would be this case's
  // too: the case is unscored, and so is every next one until a reset
  // deletes it (each reset retries it).
  if (blobsPending.length) return isolationFailed(journey, blobsPending);
  const isolatedAt = (await databaseNow()).toISOString();
  const cusoRoomId =
    journey.bot === "cuso" ? await freshCusoRoom(lane, journey.id) : undefined;
  if (journey.cusoSetup) await prepareCmoChatCase(lane, journey.cusoSetup);
  await forgetEarlierJourneys(lane, botId);
  // A watch an earlier run left waiting would fire into this journey.
  await prisma.sokoBotWatch.deleteMany({
    where: { sokoBotId: botId, status: "WAITING" },
  });
  // A journey's schedule runs and Coworker wakes are turns nobody started:
  // the owner's daily cap (20) would defer them once earlier journeys used
  // it up, as prepareEvalLane already avoids for Cuso.
  await prisma.sokoBot.update({
    where: { id: botId },
    data: { proactiveDailyLimit: 1_000 },
  });
  const world = {
    ...(await prepareJourneyWorld(
      lane,
      journey.prepare ?? [],
      journey.fixtures,
      botId,
    )),
    cusoRoomId,
    isolatedAt,
  };
  await setEvalCoworkerScript(world.coworkers.Mira, []);
  await setEvalCoworkerScript(world.coworkers.CodePat, []);
  // On a fresh database the first scan would make its cutover after the
  // Coworker's answer and baseline it: the row exists before the journey.
  await prisma.syncMetadata.upsert({
    where: { key: SOKO_EVENTS_SYNC_KEY },
    create: { key: SOKO_EVENTS_SYNC_KEY, lastSyncedAt: new Date() },
    update: {},
  });
  const journeyStartedAt = await databaseNow();
  const state: JourneyState = {
    world,
    journeyStartedAt: journeyStartedAt.toISOString(),
    steps: [],
    memo: {},
  };
  const first = await beginStep(journey, 0, lane, state, context);
  state.steps.push(first);
  return { kind: "started", turnId: first.turnIds[0] ?? null, state };
}

/**
 * A Coworker answers when its Task exists, as a real one does, not when the
 * bot has gone quiet: a background run may be waiting on exactly that answer.
 * So when the next step is the Coworker's and the owner's own turn is done,
 * the current step ends and the answer goes out.
 */
/**
 * The turn the step started: the one recorded at its start, or, for a
 * schedule step whose run was deferred, the run's turn once it began (it is
 * recorded on the step then, so later polls and the score see it too).
 */
export async function foregroundTurnId(
  journey: OwnerJourney,
  current: StepRecord,
  state: JourneyState,
): Promise<string | null> {
  if (current.turnIds[0]) return current.turnIds[0];
  if (journey.steps[current.index]?.kind !== "schedule_fires") return null;
  const [, runId] = state.memo.scheduleRun ?? [];
  const run = runId
    ? await prisma.sokoBotScheduleRun.findUnique({
        where: { id: runId },
        select: { turnId: true },
      })
    : null;
  if (run?.turnId) current.turnIds = [run.turnId];
  return run?.turnId ?? null;
}

async function coworkerCanAnswer(
  journey: OwnerJourney,
  current: StepRecord,
  lane: EvalLaneRecord,
  state: JourneyState,
): Promise<boolean> {
  const next = journey.steps[current.index + 1];
  const foreground = await foregroundTurnId(journey, current, state);
  if (next?.kind !== "coworker" || !foreground) return false;
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: foreground },
    select: { status: true },
  });
  if (!turn || ACTIVE.includes(turn.status)) return false;
  const tasks = await coworkerTasks(
    {
      lane,
      world: state.world,
      journeyStartedAt: new Date(state.journeyStartedAt),
      botId: botOf(journey, lane),
    },
    state.world.coworkers[next.coworker],
  );
  return tasks.length > 0;
}

export async function pollJourney(
  journey: OwnerJourney,
  lane: EvalLaneRecord,
  rawState: unknown,
  context: CaseContext,
): Promise<CasePoll> {
  const state = parseState(rawState);
  const botId = botOf(journey, lane);
  const current = state.steps.at(-1)!;
  const now = await databaseNow();
  if (!current.finishedAt) {
    const since = new Date(current.startedAt);
    const timedOut =
      now.getTime() - since.getTime() > (journey.stepMinutes ?? 20) * 60_000;
    const kind = journey.steps[current.index]?.kind;
    const awaits =
      kind === "coworker"
        ? "wake"
        : kind === "schedule_fires"
          ? "schedule"
          : null;
    if (
      !timedOut &&
      !(await stepSettled(
        botId,
        since,
        new Date(state.journeyStartedAt),
        now,
        awaits,
        state.memo,
      )) &&
      !(await coworkerCanAnswer(journey, current, lane, state))
    )
      return { kind: "waiting" };
    if (timedOut) {
      const open = await prisma.sokoBotTurn.findMany({
        where: {
          sokoBotId: botId,
          createdAt: { gte: since },
          status: { in: ACTIVE },
        },
        select: { id: true },
      });
      await Promise.all(
        open.map((turn) =>
          sokoBotControlPlane
            .cancelTurn(lane.userId, turn.id)
            .catch(() => undefined),
        ),
      );
      await prisma.sokoBotWatch.updateMany({
        where: { sokoBotId: botId, status: "WAITING" },
        data: { expiresAt: now },
      });
    }
    const finished = await finishStep(journey, current, state, lane, now);
    if (timedOut) {
      finished.error = `Did not settle in ${journey.stepMinutes ?? 20} minutes`;
      finished.passed = false;
      finished.checks.push({
        label: "Settled in time",
        pass: false,
        actual: finished.error,
      });
    }
    state.steps[state.steps.length - 1] = finished;
    // A step that could not finish its turns leaves nothing to build on.
    if (!timedOut && state.steps.length < journey.steps.length) {
      const next = await beginStep(
        journey,
        state.steps.length,
        lane,
        state,
        context,
      );
      state.steps.push(next);
      await saveState(context.resultId, state);
      if (!next.error) return { kind: "waiting" };
    }
    await saveState(context.resultId, state);
  }
  return {
    kind: "done",
    outcome: await journeyOutcome(journey, lane, state, context),
  };
}

/**
 * Where the journey ran. `evals:local` runs the in-process runtime (its own
 * loop, no sandbox tools); deployments run the sandbox runtime. A delta only
 * counts where both agree (`ownerbench-parity`).
 */
export function journeyRuntime(): { adapter: string; models: string } {
  return {
    adapter: effectiveSokoBotRuntimeAdapter(),
    models: localChatGptPlanEnabled() ? "chatgpt-plan" : "gateway",
  };
}

/**
 * Tokens the journey's turns used, from the model-call ledger: the cost
 * proxy where the ChatGPT plan reports no price. Background runs started by
 * a journey turn are its children and count too.
 */
export async function journeyTokens(turnIds: readonly string[]) {
  const turns = await withDescendants(turnIds);
  const where = { turnId: { in: turns.map((turn) => turn.id) } };
  const [sum, usageFree] = await Promise.all([
    prisma.sokoBotModelCall.aggregate({
      where,
      _sum: { inputTokens: true, cacheReadTokens: true, outputTokens: true },
      _count: { _all: true },
    }),
    // A model call that answered without reporting usage records 0 tokens:
    // no measurement, so it can't pull the journey's cost down. (Local
    // embeddings run in process and have no usage to report.)
    prisma.sokoBotModelCall.count({
      where: {
        ...where,
        failed: false,
        inputTokens: 0,
        role: { not: "embedding" },
      },
    }),
  ]);
  const inputTokens = sum._sum.inputTokens ?? 0;
  // No model call measured is no measurement, not a cheap journey.
  const measured = sum._count._all > 0 && turns.length > 0 && usageFree === 0;
  return {
    inputTokens,
    cachedInputTokens: sum._sum.cacheReadTokens ?? 0,
    outputTokens: sum._sum.outputTokens ?? 0,
    /** The turns these tokens belong to, background runs included. */
    tokenTurns: turns.length,
    inputTokensPerTurn: measured
      ? Math.round(inputTokens / turns.length)
      : null,
  };
}

/**
 * Cuso turns whose context organizer ran, and how many lost its Jev read (on
 * the plan, a stand-in timeout). Such a turn gets fallback picks, so on a
 * plan run it is an infrastructure error, like a failed route pick.
 */
export async function organizerFailures(
  turnIds: readonly string[],
): Promise<{ turns: number; failed: number }> {
  const turns = await withDescendants(turnIds);
  const snapshots = await prisma.sokoBotContextSnapshot.findMany({
    where: { turnId: { in: turns.map((turn) => turn.id) } },
    select: { packet: true },
  });
  let organized = 0;
  let failed = 0;
  for (const { packet } of snapshots) {
    const jev = organizerJev(packet);
    if (jev === undefined) continue;
    organized += 1;
    if (jev?.failed) failed += 1;
  }
  return { turns: organized, failed };
}

/** The organizer's Jev log in a stored packet; undefined when no organizer ran. */
export function organizerJev(
  packet: unknown,
): { failed?: string } | null | undefined {
  const organizer = (
    packet as {
      workspace?: { marketing?: { organizer?: { jev?: unknown } } | null };
    } | null
  )?.workspace?.marketing?.organizer;
  if (!organizer || typeof organizer !== "object") return undefined;
  const jev = organizer.jev;
  return jev && typeof jev === "object" ? (jev as { failed?: string }) : null;
}

/**
 * Which Jev answered the journey's questions on a plan run: real Jev, or the
 * stand-in (all of it, or for part of the journey after real Jev paused).
 * Null off the plan. A stand-in result is never compared with a real-Jev one.
 */
export function journeyJev(
  state: Pick<JourneyState, "journeyStartedAt">,
  now: Date = new Date(),
): "real" | "stand-in" | null {
  if (planJevMode() === null) return null;
  return planJevStandInDuring(new Date(state.journeyStartedAt), now)
    ? "stand-in"
    : "real";
}

/**
 * Classifier calls of the journey's turns, and how many failed. A failed
 * route pick sends the turn down a fallback (read-only clarification), so a
 * journey with any is an infrastructure error, not a verdict on the bot.
 */
export async function routingFailures(
  turnIds: readonly string[],
): Promise<{ calls: number; failed: number }> {
  const turns = await withDescendants(turnIds);
  const where = {
    role: "classifier",
    turnId: { in: turns.map((turn) => turn.id) },
  };
  const [calls, failed] = await Promise.all([
    prisma.sokoBotModelCall.count({ where }),
    prisma.sokoBotModelCall.count({ where: { ...where, failed: true } }),
  ]);
  return { calls, failed };
}

/** The turns and every turn they started, at any depth (a background run's own runs too). */
export async function withDescendants(
  turnIds: readonly string[],
): Promise<{ id: string }[]> {
  const seen = new Set(turnIds);
  let frontier = [...turnIds];
  while (frontier.length) {
    const children = await prisma.sokoBotTurn.findMany({
      where: { parentTurnId: { in: frontier }, id: { notIn: [...seen] } },
      select: { id: true },
    });
    frontier = children.map((child) => child.id);
    for (const id of frontier) seen.add(id);
  }
  return [...seen].map((id) => ({ id }));
}

/** Progress: the share of checks passed and how many steps in a row were right. */
export function journeyScore(
  journey: OwnerJourney,
  steps: readonly StepRecord[],
) {
  const checks = steps.flatMap((step) => step.checks);
  const reached = steps.findIndex((step) => !step.passed);
  return {
    stepsTotal: journey.steps.length,
    stepsRun: steps.length,
    stepsPassed: steps.filter((step) => step.passed).length,
    /** Steps right in a row from the start. */
    reached: reached === -1 ? steps.length : reached,
    checksPassed: checks.filter((check) => check.pass).length,
    checksTotal: checks.length,
  };
}

/**
 * A journey's verdict: its checks and the judge's. A journey with turns and no
 * judge verdict (the judge failed) is unscored, never a pass.
 */
export function journeyStatus(
  checksPass: boolean,
  hadTurns: boolean,
  judge: { verdict: string } | null,
): "PASSED" | "FAILED" | "ERROR" {
  if (hadTurns && !judge) return "ERROR";
  return checksPass && judge?.verdict !== "fail" ? "PASSED" : "FAILED";
}

async function journeyOutcome(
  journey: OwnerJourney,
  lane: EvalLaneRecord,
  state: JourneyState,
  context: CaseContext,
): Promise<CaseOutcome> {
  const turnIds = state.steps.flatMap((step) => step.turnIds);
  const routing = await routingFailures(turnIds);
  if (routing.failed > 0)
    return {
      status: "ERROR",
      checks: [],
      output: { journey: journey.id, routing, steps: state.steps },
      error: `Routing was unavailable: ${routing.failed} of ${routing.calls} classifier call(s) failed, so turns ran on the fallback route and the journey measures that, not the bot`,
      turnIds,
    };
  const organizer = localChatGptPlanEnabled()
    ? await organizerFailures(turnIds)
    : { turns: 0, failed: 0 };
  if (organizer.failed > 0)
    return {
      status: "ERROR",
      checks: [],
      output: { journey: journey.id, organizer, steps: state.steps },
      error: `The context organizer was unavailable: its plan stand-in failed on ${organizer.failed} of ${organizer.turns} organized turn(s), so those turns ran on fallback context and the journey measures that, not the bot`,
      turnIds,
    };
  const unreached = journey.steps
    .slice(state.steps.length)
    .map((step, offset) => ({
      label: `Step ${state.steps.length + offset + 1} reached`,
      pass: false,
      actual: "not reached",
    }));
  const checks = [
    ...state.steps.flatMap((step) =>
      step.checks.map((check) => ({
        ...check,
        label: `${step.index + 1}. ${check.label}`,
      })),
    ),
    ...unreached,
  ];
  const score = journeyScore(journey, state.steps);
  let judge: { verdict: SokoBotJudgeVerdict; model: string } | null = null;
  if (turnIds.length)
    judge = await judgeEvalChain(
      turnIds,
      journeyJudgeScenario(journey),
      state.steps.map((step) => ({
        room: "owner journey",
        from:
          step.kind === "owner"
            ? "Owner"
            : step.kind === "teammate"
              ? "Teammate (not the owner)"
              : step.kind === "coworker"
                ? "Task event"
                : "Schedule",
        content: step.label,
      })),
      context.judgeModel,
    ).catch((error: unknown) => {
      recordCoreWarning(
        { operation: "eval_tick" },
        {
          message:
            "Could not judge an owner journey, so it is scored by its checks alone",
          why: "Judging the chain threw",
        },
        {
          evalJudgeFailures: [
            { turnId: turnIds.at(-1), ...messageSafeErrorFields(error) },
          ],
        },
      );
      return null;
    });
  const status = journeyStatus(
    checks.every((check) => check.pass),
    turnIds.length > 0,
    judge?.verdict ?? null,
  );
  if (status === "ERROR")
    return {
      status,
      checks,
      output: { journey: journey.id, score, steps: state.steps },
      error:
        "The judge was unavailable, so the journey is unscored: neither a pass nor a regression",
      turnIds,
    };
  const passed = status === "PASSED";
  const totals = {
    turns: turnIds.length,
    toolCalls: state.steps.reduce(
      (sum, step) => sum + (step.toolCalls ?? 0),
      0,
    ),
    toolErrors: state.steps.reduce(
      (sum, step) => sum + (step.toolErrors?.length ?? 0),
      0,
    ),
    retries: state.steps.reduce((sum, step) => sum + (step.retries ?? 0), 0),
    costUsd: state.steps.reduce((sum, step) => sum + (step.costUsd ?? 0), 0),
    durationMs: state.steps.reduce(
      (sum, step) => sum + (step.durationMs ?? 0),
      0,
    ),
    ...(await journeyTokens(turnIds)),
  };
  return {
    status: passed ? "PASSED" : "FAILED",
    checks,
    judge: judge?.verdict ?? null,
    judgeModel: judge?.model ?? null,
    output: {
      journey: journey.id,
      level: journey.level,
      runtime: journeyRuntime(),
      jev: journeyJev(state),
      score,
      totals,
      answer: state.steps.at(-1)?.answer ?? null,
      steps: state.steps,
    },
    turnIds,
  };
}
