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
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { inheritedScheduleRoute } from "@/lib/soko-bot/system-routes";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { simulateSokoBotTaskEvent } from "@/services/soko-bot-lab.service";
import { judgeEvalChain } from "@/services/soko-bot-lab-judge.service";
import { startLabScenarioTurn } from "@/services/soko-bot-lab-scenario.service";
import { scheduleRunPrompt } from "@/services/soko-bot-schedules-sync.service";
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
  type EvalLaneRecord,
  resetEvalLaneForSokoBot,
} from "../eval-lanes.service";
import { coworkerTasks, outcomeCheck } from "./journey-checks";
import { type JourneyWorld, prepareJourneyWorld } from "./journey-world";
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
});
type JourneyState = z.infer<typeof stateSchema>;

function botOf(journey: OwnerJourney, lane: EvalLaneRecord): string {
  return journey.bot === "cuso" ? lane.cusoBotId : lane.sokoBotId;
}

function stepLabel(step: JourneyStep): string {
  if (step.kind === "owner") return `Owner: ${step.message}`;
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

/** Starts one step; a string is why it could not start. */
async function startStep(
  journey: OwnerJourney,
  index: number,
  lane: EvalLaneRecord,
  world: JourneyWorld,
  context: CaseContext,
  journeyStartedAt: Date,
): Promise<string | { error: string }> {
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
    return reconcile(
      await sokoBotControlPlane.startTurn({
        userId: lane.userId,
        workspaceId: lane.workspaceId,
        sokoBotId: botId,
        clientTurnId,
        message: step.message,
      }),
    );
  }
  if (step.kind === "coworker") {
    const [task] = await coworkerTasks(
      { lane, world, journeyStartedAt, botId },
      world.coworkers[step.coworker],
    );
    if (!task) return { error: `No Task for ${step.coworker} to answer on` };
    const simulated = await simulateSokoBotTaskEvent({
      userId: lane.userId,
      workspaceId: lane.workspaceId,
      taskId: task.id,
      status: step.status,
      comment: step.comment,
    }).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    if ("error" in simulated) return { error: simulated.error };
    return simulated.turnId ?? { error: "The Task event woke no turn" };
  }
  const schedule = await prisma.sokoBotSchedule.findFirst({
    where: { sokoBotId: botId, systemKey: null, enabled: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!schedule) return { error: "No schedule to fire" };
  return reconcile(
    await sokoBotControlPlane.startTurn({
      userId: lane.userId,
      sokoBotId: botId,
      workspaceId: lane.workspaceId,
      clientTurnId,
      message: scheduleRunPrompt(schedule),
      source: "SCHEDULE",
      ownScheduleId: schedule.id,
      presetRoute: inheritedScheduleRoute(schedule.capabilityNames),
    }),
  );
}

async function stepTurnIds(botId: string, since: Date): Promise<string[]> {
  const turns = await prisma.sokoBotTurn.findMany({
    where: { sokoBotId: botId, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return turns.map((turn) => turn.id);
}

/** Whether the step's turns, waits and follow-ups have all settled. */
async function stepSettled(
  botId: string,
  since: Date,
  now: Date,
): Promise<boolean> {
  const active = await prisma.sokoBotTurn.count({
    where: {
      sokoBotId: botId,
      createdAt: { gte: since },
      status: { in: ACTIVE },
    },
  });
  if (active > 0) return false;
  const last = await prisma.sokoBotTurn.findFirst({
    where: { sokoBotId: botId, createdAt: { gte: since } },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
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
    select: { capability: true, status: true, input: true },
  });
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
  ).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  if (typeof started === "string") return { ...record, turnIds: [started] };
  return {
    ...record,
    finishedAt: startedAt.toISOString(),
    error: started.error,
    passed: false,
    checks: [{ label: "Step could start", pass: false, actual: started.error }],
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
  if (journey.bot === "soko-bot") await resetEvalLaneForSokoBot(lane);
  if (journey.cusoSetup) await prepareCmoChatCase(lane, journey.cusoSetup);
  const world = await prepareJourneyWorld(lane, journey.prepare ?? []);
  await setEvalCoworkerScript(world.coworkers.Mira, []);
  await setEvalCoworkerScript(world.coworkers.CodePat, []);
  const journeyStartedAt = await databaseNow();
  const state: JourneyState = {
    world,
    journeyStartedAt: journeyStartedAt.toISOString(),
    steps: [],
  };
  const first = await beginStep(journey, 0, lane, state, context);
  state.steps.push(first);
  return { kind: "started", turnId: first.turnIds[0] ?? null, state };
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
    if (!timedOut && !(await stepSettled(botId, since, now)))
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

async function journeyOutcome(
  journey: OwnerJourney,
  lane: EvalLaneRecord,
  state: JourneyState,
  context: CaseContext,
): Promise<CaseOutcome> {
  const turnIds = state.steps.flatMap((step) => step.turnIds);
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
  const passed =
    checks.every((check) => check.pass) && judge?.verdict.verdict !== "fail";
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
  };
  return {
    status: passed ? "PASSED" : "FAILED",
    checks,
    judge: judge?.verdict ?? null,
    judgeModel: judge?.model ?? null,
    output: {
      journey: journey.id,
      level: journey.level,
      score,
      totals,
      answer: state.steps.at(-1)?.answer ?? null,
      steps: state.steps,
    },
    turnIds,
  };
}
