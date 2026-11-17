import {
  type EvalResultStatus,
  type EvalRunTrigger,
  Prisma,
} from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import {
  countOutcomes,
  type EvalOutcome,
  type EvalOutcomeCounts,
  type EvalResultState,
  evalOutcome,
  passRate,
} from "@/lib/evals/eval-compare";
import {
  evalCommit,
  evalEnvironment,
  prNumberFromCommitMessage,
} from "@/lib/evals/eval-environment";
import { recordCoreError } from "@/lib/evlog";
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

export interface CreateEvalRunInput {
  trigger: EvalRunTrigger;
  suites?: EvalSuite[];
  caseIds?: string[];
  repeats?: number;
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
  const cases = selectEvalCases({ suites, caseIds });
  if (cases.length === 0) throw new EvalRunError("No cases to run");
  const commit = evalCommit();
  const environment = evalEnvironment();
  const commitSha =
    commit.commitSha ??
    (environment === "local" ? (input.commit?.sha ?? null) : null);
  const commitMessage =
    commit.commitMessage ??
    (environment === "local" ? (input.commit?.message ?? null) : null);
  for (const versionId of [input.sokoBotVersionId, input.cusoVersionId])
    if (versionId && !(await isRunnableSokoBotVersionId(versionId)))
      throw new EvalRunError(`Unknown or unapproved version: ${versionId}`);
  const defaults = await defaultEvalVersions();
  return prisma.evalRun.create({
    data: {
      trigger: input.trigger,
      suites,
      caseIds,
      repeats,
      commitSha,
      commitMessage,
      prNumber: commit.prNumber ?? prNumberFromCommitMessage(commitMessage),
      environment,
      label: input.label ?? null,
      startedByUserId: input.startedByUserId ?? null,
      models: {
        sokoBotVersionId: input.sokoBotVersionId ?? defaults.sokoBot,
        cusoVersionId: input.cusoVersionId ?? defaults.cuso,
      },
      results: {
        create: Array.from(
          { length: repeats },
          (_, index) => index + 1,
        ).flatMap((repeat) =>
          cases.map((evalCase, position) => ({
            caseId: evalCase.id,
            suite: evalCase.suite,
            repeat,
            position,
          })),
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
 * The weekly run, once per UTC week (Monday to Sunday) and one repeat: a
 * second cron call the same week does nothing. More repeats are for runs
 * someone starts. Its trigger stays `DAILY`, the baseline every run is
 * compared with.
 */
export async function createWeeklyEvalRun(now = new Date()) {
  const thisWeek = await prisma.evalRun.findFirst({
    where: { trigger: "DAILY", createdAt: { gte: evalWeekStart(now) } },
    select: { id: true },
  });
  if (thisWeek) return null;
  return createEvalRun({ trigger: "DAILY", label: "Weekly", repeats: 1 });
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

/** The queued run first in line starts once nothing else is running. */
async function startNextRun() {
  const running = await prisma.evalRun.findFirst({
    where: { status: "RUNNING" },
    orderBy: { createdAt: "asc" },
  });
  if (running) return running;
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

function outcomeData(outcome: CaseOutcome, startedAt: Date | null) {
  return {
    status: outcome.status,
    finishedAt: new Date(),
    checks: outcome.checks,
    judge: outcome.judge ?? Prisma.DbNull,
    judgeModel: outcome.judgeModel ?? null,
    output: outcome.output as Prisma.InputJsonValue,
    error: outcome.error ?? null,
    durationMs: startedAt ? Date.now() - startedAt.getTime() : null,
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
  await prisma.evalResult.update({
    where: { id: resultId },
    data: {
      ...outcomeData(outcome, startedAt),
      turnId: outcome.turnIds[0] ?? undefined,
      costUsdMicros: await turnsCost(outcome.turnIds),
    },
  });
}

/** One step for one lane: score the running case, or start the next. */
async function advanceLane(
  runId: string,
  repeat: number,
  shouldContinue: () => boolean,
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
    if ((await startNextCase(runId, repeat, lane)) !== "settled") return;
  }
}

async function startNextCase(
  runId: string,
  repeat: number,
  lane: Awaited<ReturnType<typeof getEvalLane>>,
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
  const startedAt = new Date();
  const context = {
    resultId: next.id,
    firstOfSuite: earlier === 0,
    startedAt,
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
      state: started.state as Prisma.InputJsonValue,
    },
  });
  return "started";
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
 * The tick's failures on one error, since an event holds one: on the admin
 * tick's request event while it is live, else a standalone event (the cron).
 */
function recordEvalTickFailures(
  runId: string,
  laneFailures: ({ lane: number } & SafeErrorFields)[],
  emailFailure: SafeErrorFields | undefined,
) {
  const fields = {
    evalRun: { id: runId },
    ...(laneFailures.length > 0 ? { evalLaneFailures: laneFailures } : {}),
    ...(emailFailure ? { evalRegressionEmailFailure: emailFailure } : {}),
  };
  if (laneFailures.length > 0) {
    recordCoreError(
      { operation: "eval_tick" },
      {
        message: "Could not move an eval run's lanes on",
        why: "A lane's step threw",
        fix: `The next tick retries each lane. If one fails every tick, check evalLaneFailures[].errorName and status.${emailFailure ? ` The regression email failed too (evalRegressionEmailFailure). ${REGRESSION_EMAIL_FIX}` : ""}`,
      },
      fields,
    );
  } else if (emailFailure) {
    recordCoreError(
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
  await Promise.all(
    Array.from({ length: run.repeats }, (_, index) =>
      advanceLane(run.id, index + 1, shouldContinue).catch((error: unknown) => {
        // Only safe fields: a lane runs a Soko Bot turn, and its error can
        // quote the prompt.
        laneFailures.push({
          lane: index + 1,
          ...messageSafeErrorFields(error),
        });
      }),
    ),
  );
  let completion: Awaited<ReturnType<typeof completeIfDone>> | undefined;
  try {
    completion = await completeIfDone(run);
  } finally {
    // Also when completing throws, so the lanes' failures are not lost.
    recordEvalTickFailures(run.id, laneFailures, completion?.emailFailure);
  }
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

/** Completed daily runs before `before`, newest first. */
async function dailyHistory(before: Date, excludeRunId?: string) {
  const runs = await prisma.evalRun.findMany({
    where: {
      trigger: "DAILY",
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
    select: { runId: true, caseId: true, status: true },
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
  results: ResultRow[];
}

function summarize(
  cases: readonly EvalCaseReport[],
  results: readonly ResultRow[],
) {
  const counts: EvalOutcomeCounts = countOutcomes(cases.map((c) => c.outcome));
  const states = results.map((result) => result.status);
  return {
    counts,
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
  const history = await dailyHistory(run.createdAt, run.id);
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
  const current = statesByCase(run.results);
  const cases: EvalCaseReport[] = [...current.entries()].map(
    ([caseId, states]) => {
      const definition: EvalCase | undefined = evalCase(caseId);
      const rates = historyRates(caseId);
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
        baselinePassRate: rates[0] ?? null,
        history: rates,
        results: run.results.filter((result) => result.caseId === caseId),
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
    select: { id: true, createdAt: true },
  });
  if (!run) throw new EvalRunError("Eval run not found");
  const baseline = await prisma.evalRun.findFirst({
    where: {
      trigger: "DAILY",
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
    by: ["runId", "suite", "status"],
    where: { runId: { in: runs.map((run) => run.id) } },
    _count: { _all: true },
    _sum: { costUsdMicros: true },
  });
  return runs.map((run) => {
    const rows = grouped.filter((row) => row.runId === run.id);
    const suites = Object.fromEntries(
      run.suites.map((suite) => {
        const count = (status: EvalResultStatus) =>
          rows
            .filter((row) => row.suite === suite && row.status === status)
            .reduce((total, row) => total + row._count._all, 0);
        const passed = count("PASSED");
        const scored = passed + count("FAILED") + count("ERROR");
        return [
          suite,
          {
            passed,
            scored,
            failed: count("FAILED"),
            errors: count("ERROR"),
            skipped: count("SKIPPED"),
            open: count("PENDING") + count("RUNNING"),
            passRate: scored ? passed / scored : null,
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
