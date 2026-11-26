import {
  type EvalResultStatus,
  type EvalRunTrigger,
  Prisma,
} from "@sokosumi/database";
import { z } from "zod";

import { jsonInput } from "@/helpers/prisma-json";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import {
  aboveUsual,
  caseWeightedPassRate,
  countOutcomes,
  type EvalOutcome,
  type EvalOutcomeCounts,
  type EvalResultState,
  evalOutcome,
  median,
  passRate,
  usualValue,
} from "@/lib/evals/eval-compare";
import {
  comparableRuns,
  evalCommit,
  evalEnvironment,
  prNumberFromCommitMessage,
} from "@/lib/evals/eval-environment";
import {
  recordCoreError,
  recordCoreWarning,
  tryUseLiveLogger,
} from "@/lib/evlog";
import {
  messageSafeErrorFields,
  type SafeErrorFields,
} from "@/lib/safe-error-fields";
import { sokoBotTurnsSyncService } from "@/services/soko-bot-turns-sync.service";
import {
  isRunnableSokoBotVersionId,
  resolveSokoBotVersion,
} from "@/services/soko-bot-version.service";
import {
  type CaseOutcome,
  caseError,
  pollEvalCase,
  startEvalCase,
} from "./eval-case-runner";
import {
  EVAL_SUITES,
  type EvalCase,
  type EvalSuite,
  evalCase,
  isJudgedEvalCase,
  minimumEvalRepeats,
  selectEvalCases,
} from "./eval-cases";
import { stopPendingAfterBudgetError } from "./eval-infrastructure";
import {
  defaultEvalVersions,
  EVAL_LANE_COUNT,
  ensureEvalLanes,
  evalLaneBotIds,
  getEvalLane,
  pauseEvalLanes,
  prepareEvalLane,
} from "./eval-lanes.service";

export class EvalRunError extends Error {}

/** Daily runs a case's history reads: regressions against these, flakiness from them. */
const HISTORY_RUNS = 10;
const BASELINE_WINDOW = 5;
/** How many at-once cases (skipped, refused) a lane may settle in one tick. */
const INSTANT_CASES_PER_TICK = 20;
/**
 * A run still running after this long is stuck: the longest weekly run took
 * 9.4 hours (2026-11-23), and a stuck run holds every later run in the queue.
 */
export const EVAL_RUN_TIMEOUT_MS = 24 * 60 * 60_000;
/** Repeats the weekly run gives judged cases: one judge flip is not a regression. */
const WEEKLY_JUDGED_REPEATS = 2;
/**
 * The judge of the weekly run. Opus judges runs someone starts; the routine
 * run takes a cheaper model from the EU list in `model-policy.ts`.
 */
export const WEEKLY_JUDGE_MODEL = "anthropic/claude-sonnet-5";

export interface CreateEvalRunInput {
  trigger: EvalRunTrigger;
  suites?: EvalSuite[];
  caseIds?: string[];
  repeats?: number;
  /** Repeats for cases a judge grades, at least `repeats`; the rest run `repeats` times. */
  judgedRepeats?: number;
  label?: string | null;
  startedByUserId?: string | null;
  /** A version to try before promoting it; the default version otherwise. */
  sokoBotVersionId?: string | null;
  cusoVersionId?: string | null;
  /** Only where Vercel does not say which commit runs (a local Core). */
  commit?: { sha?: string | null; message?: string | null };
}

export async function createEvalRun(input: CreateEvalRunInput) {
  const caseIds = [...new Set(input.caseIds ?? [])];
  const suites: EvalSuite[] = caseIds.length
    ? [
        ...new Set(
          caseIds.map((id) => {
            const found = evalCase(id);
            if (!found) throw new EvalRunError(`Unknown eval case: ${id}`);
            return found.suite;
          }),
        ),
      ]
    : (input.suites ?? [...EVAL_SUITES]);
  // One repeat unless asked: more repeats tell chance from a real change,
  // at that many times the cost.
  const repeats = input.repeats ?? 1;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > EVAL_LANE_COUNT)
    throw new EvalRunError(`Repeats must be 1 to ${EVAL_LANE_COUNT}`);
  const judgedRepeats = input.judgedRepeats ?? repeats;
  if (
    !Number.isInteger(judgedRepeats) ||
    judgedRepeats < repeats ||
    judgedRepeats > EVAL_LANE_COUNT
  )
    throw new EvalRunError(
      `Judged repeats must be ${repeats} to ${EVAL_LANE_COUNT}`,
    );
  const cases = selectEvalCases({ suites, caseIds });
  if (cases.length === 0) throw new EvalRunError("No cases to run");
  const repeatsOf = (evalCase: EvalCase) =>
    Math.max(
      isJudgedEvalCase(evalCase) ? judgedRepeats : repeats,
      minimumEvalRepeats(evalCase),
    );
  const lanes = Math.max(...cases.map(repeatsOf));
  const commit = evalCommit();
  const environment = evalEnvironment();
  const local = environment === "local" || environment === "local-chatgpt-plan";
  const commitSha =
    commit.commitSha ?? (local ? (input.commit?.sha ?? null) : null);
  const commitMessage =
    commit.commitMessage ?? (local ? (input.commit?.message ?? null) : null);
  for (const versionId of [input.sokoBotVersionId, input.cusoVersionId])
    if (versionId && !(await isRunnableSokoBotVersionId(versionId)))
      throw new EvalRunError(`Unknown or unapproved version: ${versionId}`);
  const defaults = await defaultEvalVersions();
  return prisma.evalRun.create({
    data: {
      trigger: input.trigger,
      suites,
      caseIds,
      repeats: lanes,
      commitSha,
      commitMessage,
      prNumber: commit.prNumber ?? prNumberFromCommitMessage(commitMessage),
      environment,
      label:
        input.label ??
        (environment === "local-chatgpt-plan"
          ? "local, ChatGPT plan (approximate)"
          : null),
      startedByUserId: input.startedByUserId ?? null,
      models: {
        sokoBotVersionId: input.sokoBotVersionId ?? defaults.sokoBot,
        cusoVersionId: input.cusoVersionId ?? defaults.cuso,
      },
      results: {
        create: Array.from({ length: lanes }, (_, index) => index + 1).flatMap(
          (repeat) =>
            cases.flatMap((evalCase, position) =>
              repeat <= repeatsOf(evalCase)
                ? [
                    {
                      caseId: evalCase.id,
                      suite: evalCase.suite,
                      repeat,
                      position,
                    },
                  ]
                : [],
            ),
        ),
      },
    },
  });
}

/** Monday 00:00 UTC of the week `now` falls in. */
export function evalWeekStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}

/**
 * The weekly run, once per UTC week (Monday to Sunday): a second cron call
 * the same week does nothing. One repeat, two for the cases a judge grades.
 * Its trigger stays `DAILY`, the baseline every run is compared with.
 */
export async function createWeeklyEvalRun(now = new Date()) {
  const thisWeek = await prisma.evalRun.findFirst({
    where: { trigger: "DAILY", createdAt: { gte: evalWeekStart(now) } },
    select: { id: true },
  });
  if (thisWeek) return null;
  return createEvalRun({
    trigger: "DAILY",
    label: "Weekly",
    repeats: 1,
    judgedRepeats: WEEKLY_JUDGED_REPEATS,
  });
}

const runModelsSchema = (value: unknown) => {
  const models = (value ?? {}) as {
    sokoBotVersionId?: unknown;
    cusoVersionId?: unknown;
  };
  return {
    sokoBotVersionId:
      typeof models.sokoBotVersionId === "string"
        ? models.sokoBotVersionId
        : null,
    cusoVersionId:
      typeof models.cusoVersionId === "string" ? models.cusoVersionId : null,
  };
};

/**
 * Ends a run that has run past `EVAL_RUN_TIMEOUT_MS`: what had not finished
 * becomes an error, and the run completes so the queue moves on.
 */
async function timeOutStuckRun(run: {
  id: string;
  repeats: number;
  trigger: EvalRunTrigger;
  startedAt: Date | null;
}): Promise<boolean> {
  const now = await databaseNow();
  if (
    !run.startedAt ||
    now.getTime() - run.startedAt.getTime() < EVAL_RUN_TIMEOUT_MS
  )
    return false;
  const open = await prisma.evalResult.updateMany({
    where: { runId: run.id, status: { in: ["PENDING", "RUNNING"] } },
    data: {
      status: "ERROR",
      error: `The run timed out after ${EVAL_RUN_TIMEOUT_MS / 3_600_000} hours`,
      finishedAt: now,
    },
  });
  // Once: later ticks only wait on a case's late cost.
  if (open.count > 0)
    recordCoreWarning(
      { operation: "eval_tick" },
      {
        message: "Timed out an eval run that was stuck",
        why: `It was still running ${EVAL_RUN_TIMEOUT_MS / 3_600_000} hours after it started`,
        fix: "Its open cases are errors now. Check why they never settled: a turn that never ended, or a lane that kept failing.",
      },
      { evalRun: { id: run.id }, evalOpenCases: open.count },
    );
  // Still waiting on a case's late cost: the next run stays queued.
  return (await completeIfDone(run)).completed;
}

/** The queued run first in line starts once nothing else is running. */
async function startNextRun() {
  const running = await prisma.evalRun.findFirst({
    where: { status: "RUNNING" },
    orderBy: { createdAt: "asc" },
  });
  if (running && !(await timeOutStuckRun(running))) return running;
  const queued = await prisma.evalRun.findFirst({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });
  if (!queued) return null;
  const lanes = await ensureEvalLanes(queued.repeats);
  const defaults = await defaultEvalVersions();
  const chosen = runModelsSchema(queued.models);
  const versions = {
    sokoBot: chosen.sokoBotVersionId ?? defaults.sokoBot,
    cuso: chosen.cusoVersionId ?? defaults.cuso,
  };
  for (const lane of lanes) await prepareEvalLane(lane, versions);
  const [sokoBotVersion, cusoVersion] = await Promise.all([
    resolveSokoBotVersion(versions.sokoBot),
    resolveSokoBotVersion(versions.cuso),
  ]);
  return prisma.evalRun.update({
    where: { id: queued.id },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      models: {
        sokoBotVersionId: versions.sokoBot,
        sokoBotModel: sokoBotVersion.model,
        cusoVersionId: versions.cuso,
        cusoModel: cusoVersion.model,
      },
    },
  });
}

function outcomeData(
  outcome: CaseOutcome,
  startedAt: Date | null,
  finishedAt: Date,
) {
  return {
    status: outcome.status,
    finishedAt,
    checks: jsonInput(outcome.checks),
    judge: outcome.judge ? jsonInput(outcome.judge) : Prisma.DbNull,
    judgeModel: outcome.judgeModel ?? null,
    output: jsonInput(outcome.output),
    error: outcome.error ?? null,
    durationMs: startedAt
      ? Math.max(0, finishedAt.getTime() - startedAt.getTime())
      : null,
  };
}

/** What the case's turns cost, the classifier and judge included. */
async function turnsCost(turnIds: readonly string[]) {
  if (turnIds.length === 0) return null;
  const turns = await prisma.sokoBotTurn.findMany({
    where: {
      OR: [
        { id: { in: [...turnIds] } },
        { parentTurnId: { in: [...turnIds] } },
      ],
    },
    select: { costUsdMicros: true, overheadCostUsdMicros: true },
  });
  return turns.reduce(
    (total, turn) =>
      total + (turn.costUsdMicros ?? BigInt(0)) + turn.overheadCostUsdMicros,
    BigInt(0),
  );
}

async function finish(
  resultId: string,
  outcome: CaseOutcome,
  startedAt: Date | null,
) {
  const turnId = outcome.turnIds.at(0);
  await prisma.evalResult.update({
    where: { id: resultId },
    data: {
      ...outcomeData(outcome, startedAt, await databaseNow()),
      ...(turnId !== undefined ? { turnId } : {}),
      costUsdMicros: await turnsCost(outcome.turnIds),
    },
  });
}

/** One step for one lane: score the running case, or start the next. */
async function advanceLane(
  runId: string,
  repeat: number,
  shouldContinue: () => boolean,
  judgeModel: string | undefined,
) {
  const lane = await getEvalLane(repeat);
  const current = await prisma.evalResult.findFirst({
    where: { runId, repeat, status: "RUNNING" },
  });
  if (current) {
    const definition = evalCase(current.caseId);
    const context = {
      resultId: current.id,
      firstOfSuite: false,
      startedAt: current.startedAt ?? current.createdAt,
      judgeModel,
    };
    const polled = definition
      ? await pollEvalCase(
          definition,
          lane,
          { turnId: current.turnId, state: current.state },
          context,
        ).catch((error: unknown) => ({
          kind: "done" as const,
          outcome: caseError(
            error instanceof Error ? error.message : String(error),
            current.turnId ? [current.turnId] : [],
          ),
        }))
      : {
          kind: "done" as const,
          outcome: caseError("This case no longer exists"),
        };
    if (polled.kind === "waiting") return;
    await finish(current.id, polled.outcome, current.startedAt);
  }
  // A case that settles at once (skipped, or refused before its turn) is
  // not a reason to wait a minute for the next one.
  for (let step = 0; step < INSTANT_CASES_PER_TICK; step += 1) {
    if (!shouldContinue()) return;
    if ((await startNextCase(runId, repeat, lane, judgeModel)) !== "settled")
      return;
  }
}

async function startNextCase(
  runId: string,
  repeat: number,
  lane: Awaited<ReturnType<typeof getEvalLane>>,
  judgeModel: string | undefined,
): Promise<"none" | "busy" | "started" | "settled"> {
  if (await stopPendingAfterBudgetError(runId, repeat)) return "none";
  const next = await prisma.evalResult.findFirst({
    where: { runId, repeat, status: "PENDING" },
    orderBy: { position: "asc" },
  });
  if (!next) return "none";
  const definition = evalCase(next.caseId);
  if (!definition) {
    await finish(next.id, caseError("This case no longer exists"), null);
    return "settled";
  }
  const earlier = await prisma.evalResult.count({
    where: {
      runId,
      repeat,
      suite: definition.suite,
      position: { lt: next.position },
    },
  });
  const startedAt = await databaseNow();
  const context = {
    resultId: next.id,
    firstOfSuite: earlier === 0,
    startedAt,
    judgeModel,
  };
  const started = await startEvalCase(definition, lane, context).catch(
    (error: unknown) => ({
      kind: "done" as const,
      outcome: caseError(
        error instanceof Error ? error.message : String(error),
      ),
    }),
  );
  if (started.kind === "busy") return "busy";
  if (started.kind === "done") {
    await finish(next.id, started.outcome, startedAt);
    return "settled";
  }
  await prisma.evalResult.update({
    where: { id: next.id },
    data: {
      status: "RUNNING",
      startedAt,
      turnId: started.turnId,
      state: jsonInput(started.state),
    },
  });
  return "started";
}

/** How long a finished run waits on a case's outliving turns before it completes with that cost marked incomplete. */
const UNSETTLED_COST_WAIT_MS = 30 * 60_000;

/**
 * A case that ended while its turns still ran was charged too early: its
 * cost is read again from all of its turns (`caseTurnIds`). True while one of
 * them still runs and the case ended under UNSETTLED_COST_WAIT_MS ago, so the
 * run waits; after that its cost stands, marked `costIncomplete`.
 */
export async function reconcileUnsettledCosts(
  runId: string,
  now = new Date(),
): Promise<boolean> {
  // Few per run: an errored case whose turns outlived it records them.
  const errored = await prisma.evalResult.findMany({
    where: { runId, status: "ERROR" },
    select: { id: true, output: true, finishedAt: true },
  });
  let waiting = false;
  for (const result of errored) {
    const parsed = z
      .object({ caseTurnIds: z.array(z.string()) })
      .safeParse(result.output);
    if (!parsed.success) continue;
    const ids = parsed.data.caseTurnIds;
    const running = await prisma.sokoBotTurn.count({
      where: {
        id: { in: ids },
        status: { in: ["STARTING", "RUNNING", "CANCEL_REQUESTED"] },
      },
    });
    const costUsdMicros = await turnsCost(ids);
    const ended = result.finishedAt?.getTime() ?? now.getTime();
    if (running > 0 && now.getTime() - ended < UNSETTLED_COST_WAIT_MS) {
      waiting = true;
      await prisma.evalResult.update({
        where: { id: result.id },
        data: { costUsdMicros },
      });
      continue;
    }
    await prisma.evalResult.update({
      where: { id: result.id },
      data: {
        costUsdMicros,
        output: jsonInput({
          ...(result.output as Record<string, unknown>),
          costIncomplete: running > 0,
        }),
      },
    });
  }
  return waiting;
}

/** Whether the run completed, and why its regression email failed if it did. */
async function completeIfDone(run: {
  id: string;
  repeats: number;
  trigger: EvalRunTrigger;
}): Promise<{ completed: boolean; emailFailure?: SafeErrorFields }> {
  const open = await prisma.evalResult.count({
    where: { runId: run.id, status: { in: ["PENDING", "RUNNING"] } },
  });
  if (open > 0) return { completed: false };
  if (await reconcileUnsettledCosts(run.id)) return { completed: false };
  await prisma.evalRun.update({
    where: { id: run.id },
    data: { status: "COMPLETED", finishedAt: new Date() },
  });
  await pauseEvalLanes(run.repeats);
  if (run.trigger === "DAILY") {
    // Loaded here: the email reads this module's report.
    const { sendEvalRegressionEmail } = await import("./eval-report-email");
    try {
      await sendEvalRegressionEmail(run.id);
    } catch (error) {
      // Only provider metadata: a mail error can quote the report.
      return { completed: true, emailFailure: messageSafeErrorFields(error) };
    }
  }
  return { completed: true };
}

const REGRESSION_EMAIL_FIX =
  "The run is complete; read its report in the admin evals page.";

/**
 * The tick's failures on one entry: on the admin tick's request event while
 * it is live, else a standalone event (the cron). An error, unless an error
 * thrown while completing the run is about to own the event (an event holds
 * one error): then a warning, so neither replaces the other.
 */
function recordEvalTickFailures(
  runId: string,
  laneFailures: ({ lane: number } & SafeErrorFields)[],
  emailFailure: SafeErrorFields | undefined,
  level: "error" | "warn",
) {
  const record = level === "error" ? recordCoreError : recordCoreWarning;
  const fields = {
    evalRun: { id: runId },
    ...(laneFailures.length > 0 ? { evalLaneFailures: laneFailures } : {}),
    ...(emailFailure ? { evalRegressionEmailFailure: emailFailure } : {}),
  };
  if (laneFailures.length > 0) {
    record(
      { operation: "eval_tick" },
      {
        message: "Could not move an eval run's lanes on",
        why: "A lane's step threw",
        fix: `The next tick retries each lane. If one fails every tick, check evalLaneFailures[].errorName and status.${emailFailure ? ` The regression email failed too (evalRegressionEmailFailure). ${REGRESSION_EMAIL_FIX}` : ""}`,
      },
      fields,
    );
  } else if (emailFailure) {
    record(
      { operation: "eval_tick" },
      {
        message: "Could not send the daily eval regression email",
        why: "Sending the report email failed",
        fix: REGRESSION_EMAIL_FIX,
      },
      fields,
    );
  }
}

/**
 * Moves the running eval run on: every lane scores the case it ran or starts
 * its next one. The minute cron calls it on mainnet; the API's tick and the
 * CLI's `--wait` call it where there is no cron (previews, a local Core).
 */
export async function tickEvalRuns(
  shouldContinue: () => boolean = () => true,
): Promise<{ runId: string | null; completed: boolean }> {
  const run = await startNextRun();
  if (!run) return { runId: null, completed: false };
  const laneFailures: ({ lane: number } & SafeErrorFields)[] = [];
  const judgeModel = run.trigger === "DAILY" ? WEEKLY_JUDGE_MODEL : undefined;
  await Promise.all(
    Array.from({ length: run.repeats }, (_, index) =>
      advanceLane(run.id, index + 1, shouldContinue, judgeModel).catch(
        (error: unknown) => {
          // Only safe fields: a lane runs a Soko Bot turn, and its error can
          // quote the prompt.
          laneFailures.push({
            lane: index + 1,
            ...messageSafeErrorFields(error),
          });
        },
      ),
    ),
  );
  let completion: Awaited<ReturnType<typeof completeIfDone>>;
  try {
    completion = await completeIfDone(run);
  } catch (error) {
    // In a live request the thrown error becomes its event's error, so the
    // lanes' failures stay beside it as a warning. Elsewhere (the cron) they
    // are their own standalone error.
    recordEvalTickFailures(
      run.id,
      laneFailures,
      undefined,
      tryUseLiveLogger() ? "warn" : "error",
    );
    throw error;
  }
  recordEvalTickFailures(
    run.id,
    laneFailures,
    completion.emailFailure,
    "error",
  );
  return { runId: run.id, completed: completion.completed };
}

/** One invocation's worth: Vercel ends Core at 300 seconds. */
const LANE_TURN_SYNC_MS = 240_000;

/**
 * Keeps reading the lanes' running turns until they settle, as the minute
 * cron does on mainnet. Where there is no cron, the request that started a
 * turn reads it for five minutes at most; a longer turn then never settled,
 * so a month's production run stayed running and its case timed out.
 */
export async function syncEvalLaneTurns(runId: string): Promise<void> {
  const run = await prisma.evalRun.findUnique({
    where: { id: runId },
    select: { repeats: true },
  });
  if (!run) return;
  const abortSignal = AbortSignal.timeout(LANE_TURN_SYNC_MS);
  await sokoBotTurnsSyncService.syncActiveTurns({
    abortSignal,
    shouldContinue: () => !abortSignal.aborted,
    sokoBotIds: await evalLaneBotIds(run.repeats),
  });
}

export async function cancelEvalRun(runId: string) {
  const run = await prisma.evalRun.findUnique({ where: { id: runId } });
  if (!run) throw new EvalRunError("Eval run not found");
  if (run.status === "COMPLETED" || run.status === "CANCELLED") return run;
  await prisma.evalResult.updateMany({
    where: { runId, status: { in: ["PENDING", "RUNNING"] } },
    data: { status: "SKIPPED", error: "The run was cancelled" },
  });
  if (run.status === "RUNNING") await pauseEvalLanes(run.repeats);
  return prisma.evalRun.update({
    where: { id: runId },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

type ResultRow = Prisma.EvalResultGetPayload<object>;

function statesByCase(results: readonly ResultRow[]) {
  const states = new Map<string, EvalResultState[]>();
  for (const result of results) {
    const list = states.get(result.caseId) ?? [];
    list.push(result.status);
    states.set(result.caseId, list);
  }
  return states;
}

/** Completed comparable runs before `before`, newest first. */
async function dailyHistory(
  before: Date,
  excludeRunId?: string,
  run: { environment: string; label: string | null } = {
    environment: "mainnet",
    label: null,
  },
) {
  const runs = await prisma.evalRun.findMany({
    where: {
      ...comparableRuns(run),
      status: "COMPLETED",
      createdAt: { lt: before },
      ...(excludeRunId ? { id: { not: excludeRunId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: HISTORY_RUNS,
    select: { id: true, createdAt: true, prNumber: true, commitSha: true },
  });
  const results = await prisma.evalResult.findMany({
    where: { runId: { in: runs.map((run) => run.id) } },
    select: {
      runId: true,
      caseId: true,
      status: true,
      costUsdMicros: true,
      durationMs: true,
    },
  });
  return { runs, results };
}

export interface EvalCaseReport {
  caseId: string;
  suite: string;
  area: string;
  title: string;
  intent: string;
  outcome: EvalOutcome;
  states: EvalResultState[];
  passRate: number | null;
  baselinePassRate: number | null;
  /** Pass rate in earlier daily runs, newest first; null where it did not run. */
  history: (number | null)[];
  /** Median of this run's repeats, and of the last weekly runs. */
  costUsd: number | null;
  usualCostUsd: number | null;
  costlier: boolean;
  durationMs: number | null;
  usualDurationMs: number | null;
  slower: boolean;
  results: ResultRow[];
}

const SCORED_STATES: readonly EvalResultState[] = ["PASSED", "FAILED"];

/** The median cost and duration of the repeats that ran to a verdict. */
function caseUsage(
  results: readonly {
    status: EvalResultState;
    costUsdMicros: bigint | null;
    durationMs: number | null;
  }[],
) {
  const scored = results.filter((result) =>
    SCORED_STATES.includes(result.status),
  );
  return {
    costUsd: median(
      scored.flatMap((result) =>
        result.costUsdMicros === null
          ? []
          : [Number(result.costUsdMicros) / 1e6],
      ),
    ),
    durationMs: median(
      scored.flatMap((result) =>
        result.durationMs === null ? [] : [result.durationMs],
      ),
    ),
  };
}

function summarize(
  cases: readonly EvalCaseReport[],
  results: readonly ResultRow[],
) {
  const counts: EvalOutcomeCounts = countOutcomes(cases.map((c) => c.outcome));
  const states = results.map((result) => result.status);
  return {
    counts,
    costlier: cases.filter((evalCase) => evalCase.costlier).length,
    slower: cases.filter((evalCase) => evalCase.slower).length,
    passRate: caseWeightedPassRate(cases.map((evalCase) => evalCase.passRate)),
    passed: states.filter((state) => state === "PASSED").length,
    scored: states.filter((state) =>
      ["PASSED", "FAILED", "ERROR"].includes(state),
    ).length,
    open: states.filter((state) => state === "PENDING" || state === "RUNNING")
      .length,
    costUsd:
      Number(
        results.reduce(
          (total, result) => total + (result.costUsdMicros ?? BigInt(0)),
          BigInt(0),
        ),
      ) / 1e6,
  };
}

export async function getEvalRunReport(runId: string) {
  const run = await prisma.evalRun.findUnique({
    where: { id: runId },
    include: { results: { orderBy: [{ position: "asc" }, { repeat: "asc" }] } },
  });
  if (!run) throw new EvalRunError("Eval run not found");
  const history = await dailyHistory(run.createdAt, run.id, run);
  const baselineRun = history.runs[0] ?? null;
  const historyRates = (caseId: string) =>
    history.runs.map((past) =>
      passRate(
        history.results
          .filter(
            (result) => result.runId === past.id && result.caseId === caseId,
          )
          .map((result) => result.status),
      ),
    );
  const usualHistory = (caseId: string) =>
    history.runs.map((past) =>
      caseUsage(
        history.results.filter(
          (result) => result.runId === past.id && result.caseId === caseId,
        ),
      ),
    );
  const current = statesByCase(run.results);
  const cases: EvalCaseReport[] = [...current.entries()].map(
    ([caseId, states]) => {
      const definition: EvalCase | undefined = evalCase(caseId);
      const rates = historyRates(caseId);
      const results = run.results.filter((result) => result.caseId === caseId);
      const usage = caseUsage(results);
      const past = usualHistory(caseId);
      const usualCostUsd = usualValue(past.map((item) => item.costUsd));
      const usualDurationMs = usualValue(past.map((item) => item.durationMs));
      const scored = rates
        .slice(0, BASELINE_WINDOW)
        .filter((rate): rate is number => rate !== null);
      return {
        caseId,
        suite: definition?.suite ?? "unknown",
        area: definition?.area ?? "Other",
        title: definition?.title ?? caseId,
        intent: definition?.intent ?? "",
        outcome: evalOutcome(states, scored),
        states,
        passRate: passRate(states),
        baselinePassRate: scored[0] ?? null,
        history: rates,
        costUsd: usage.costUsd,
        usualCostUsd,
        costlier: aboveUsual(usage.costUsd, usualCostUsd),
        durationMs: usage.durationMs,
        usualDurationMs,
        slower: aboveUsual(usage.durationMs, usualDurationMs),
        results,
      };
    },
  );
  return {
    run,
    baseline: baselineRun,
    history: history.runs,
    summary: summarize(cases, run.results),
    cases,
  };
}

/** The baseline's results for one case, to show beside this run's output. */
export async function getEvalCaseBaseline(runId: string, caseId: string) {
  const run = await prisma.evalRun.findUnique({
    where: { id: runId },
    select: { id: true, createdAt: true, environment: true, label: true },
  });
  if (!run) throw new EvalRunError("Eval run not found");
  const baseline = await prisma.evalRun.findFirst({
    where: {
      ...comparableRuns(run),
      status: "COMPLETED",
      createdAt: { lt: run.createdAt },
      id: { not: run.id },
      results: { some: { caseId } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, prNumber: true, commitSha: true },
  });
  if (!baseline) return null;
  const results = await prisma.evalResult.findMany({
    where: { runId: baseline.id, caseId },
    orderBy: { repeat: "asc" },
  });
  return { run: baseline, results };
}

/** Recent runs with their scores per suite, newest first: the trend and the run list. */
export async function listEvalRuns(limit = 30) {
  const runs = await prisma.evalRun.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const grouped = await prisma.evalResult.groupBy({
    by: ["runId", "suite", "caseId", "status"],
    where: { runId: { in: runs.map((run) => run.id) } },
    _count: { _all: true },
    _sum: { costUsdMicros: true },
  });
  return runs.map((run) => {
    const rows = grouped.filter((row) => row.runId === run.id);
    const suites = Object.fromEntries(
      run.suites.map((suite) => {
        const inSuite = rows.filter((row) => row.suite === suite);
        const count = (status: EvalResultStatus) =>
          inSuite
            .filter((row) => row.status === status)
            .reduce((total, row) => total + row._count._all, 0);
        const passed = count("PASSED");
        const scored = passed + count("FAILED") + count("ERROR");
        const caseRates = [...new Set(inSuite.map((row) => row.caseId))].map(
          (caseId) =>
            passRate(
              inSuite
                .filter((row) => row.caseId === caseId)
                .flatMap((row) =>
                  Array.from({ length: row._count._all }, () => row.status),
                ),
            ),
        );
        return [
          suite,
          {
            passed,
            scored,
            failed: count("FAILED"),
            errors: count("ERROR"),
            skipped: count("SKIPPED"),
            open: count("PENDING") + count("RUNNING"),
            passRate: caseWeightedPassRate(caseRates),
          },
        ];
      }),
    );
    const costUsd =
      Number(
        rows.reduce(
          (total, row) => total + (row._sum.costUsdMicros ?? BigInt(0)),
          BigInt(0),
        ),
      ) / 1e6;
    return { ...run, scores: suites, costUsd };
  });
}
