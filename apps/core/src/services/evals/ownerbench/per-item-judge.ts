/**
 * Owner-benchmark seam for optional per-item 3-vote judging (B1 / R1-A):
 *
 * - Live runs pick `"holistic"` (default) or `"per-item"` via
 *   `OWNERBENCH_JUDGE_MODE` (`evals:local --judge per-item`).
 * - Stored runs can be re-scored non-destructively via `rejudgeEvalRunReport`
 *   (`evals:local --rejudge RUN_ID --judge per-item --json-out FILE`), producing
 *   a `ParityReport`-compatible JSON file for `ownerbench-compare.mts` without
 *   overwriting the stored holistic verdicts in Postgres.
 */

import type { SokoBotJudgeVerdict } from "@sokosumi/soko-bot";
import pLimit from "p-limit";
import {
  caseWeightedPassRate,
  countOutcomes,
  type EvalOutcome,
  type EvalOutcomeCounts,
  type EvalResultState,
  evalOutcome,
  passRate,
} from "@/lib/evals/eval-compare";
import {
  judgeEvalChain,
  judgeEvalChainPerItem,
  type PerItemJudgeItemResult,
  sokoBotJudgeRunner,
} from "@/services/soko-bot-lab-judge.service";
import { HOLDOUT_PREFIX } from "./holdout";
import type { StepRecord } from "./journey-runner";
import { journeyJudgeScenario, type OwnerJourney } from "./journeys";
import {
  type JourneyRubricSplit,
  loadRubricSplitsForJourneys,
} from "./rubric-splits";

export function journeyRoomLog(
  steps: readonly Pick<StepRecord, "kind" | "label">[],
): { room: string; from: string; content: string }[] {
  return steps.map((step) => ({
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
  }));
}

function scoredJourneyStatus(
  checksPass: boolean,
  hadTurns: boolean,
  judge: { verdict: string } | null,
): "PASSED" | "FAILED" | "ERROR" {
  if (hadTurns && !judge) return "ERROR";
  return checksPass && judge?.verdict !== "fail" ? "PASSED" : "FAILED";
}

export const OWNERBENCH_JUDGE_MODES = ["holistic", "per-item"] as const;
export type OwnerbenchJudgeMode = (typeof OWNERBENCH_JUDGE_MODES)[number];

export function ownerbenchJudgeMode(
  raw = process.env.OWNERBENCH_JUDGE_MODE,
): OwnerbenchJudgeMode {
  if (!raw) return "holistic";
  if (raw === "holistic" || raw === "per-item") return raw;
  throw new Error(
    `Invalid OWNERBENCH_JUDGE_MODE "${raw}": expected "holistic" or "per-item"`,
  );
}

export interface JourneyJudgeOutcome {
  verdict: SokoBotJudgeVerdict;
  model: string;
  judgeMode: OwnerbenchJudgeMode;
  judgeItems?: PerItemJudgeItemResult[];
}

/** Grades an owner-benchmark chain under the chosen judge mode. */
export async function judgeJourneyChain(input: {
  journey: OwnerJourney;
  turnIds: string[];
  roomLog: { room: string; from: string; content: string }[];
  model?: string;
  mode?: OwnerbenchJudgeMode;
  privateSplitsPath?: string;
  storeOnTurn?: boolean;
}): Promise<JourneyJudgeOutcome> {
  const mode = input.mode ?? ownerbenchJudgeMode();
  const scenario = journeyJudgeScenario(input.journey);
  if (mode === "holistic") {
    const judged = await judgeEvalChain(
      input.turnIds,
      scenario,
      input.roomLog,
      input.model,
    );
    return { ...judged, judgeMode: "holistic" };
  }
  const splits = loadRubricSplitsForJourneys(
    [input.journey],
    input.privateSplitsPath,
  );
  const split = splits.get(input.journey.id);
  if (!split)
    throw new Error(`Missing frozen rubric split for ${input.journey.id}`);
  const judged = await judgeEvalChainPerItem({
    turnIds: input.turnIds,
    scenario,
    roomLog: input.roomLog,
    items: split.items,
    model: input.model,
    storeOnTurn: input.storeOnTurn,
  });
  return {
    verdict: judged.verdict,
    model: judged.model,
    judgeMode: "per-item",
    judgeItems: judged.items,
  };
}

export interface StoredEvalResultLike {
  id: string;
  caseId: string;
  repeat: number;
  status: string;
  turnId: string | null;
  checks: unknown;
  judge: unknown;
  judgeModel: string | null;
  output: unknown;
  error: string | null;
  durationMs: number | null;
}

export interface StoredEvalCaseReportLike<
  R extends StoredEvalResultLike = StoredEvalResultLike,
> {
  caseId: string;
  outcome?: EvalOutcome;
  history?: (number | null)[];
  states: string[];
  passRate: number | null;
  results: R[];
}

export interface StoredEvalRunSummaryLike {
  counts?: EvalOutcomeCounts;
  passRate?: number | null;
  passed?: number;
  scored?: number;
  open?: number;
}

export interface StoredEvalRunReportLike<
  C extends StoredEvalCaseReportLike = StoredEvalCaseReportLike,
> {
  run: { results?: StoredEvalResultLike[] } & object;
  summary?: StoredEvalRunSummaryLike;
  cases: C[];
}

const OUTCOME_BASELINE_WINDOW = 5;

const VALID_RESULT_STATES = new Set<EvalResultState>([
  "PENDING",
  "RUNNING",
  "PASSED",
  "FAILED",
  "ERROR",
  "SKIPPED",
]);

function asResultStates(states: readonly string[]): EvalResultState[] {
  return states.filter((state): state is EvalResultState =>
    VALID_RESULT_STATES.has(state as EvalResultState),
  );
}

export type PerItemJudgeFn = (input: {
  journey: OwnerJourney;
  split: JourneyRubricSplit;
  turnIds: string[];
  roomLog: { room: string; from: string; content: string }[];
}) => Promise<{
  verdict: SokoBotJudgeVerdict;
  model: string;
  items: PerItemJudgeItemResult[];
}>;

function storedStepsOf(output: unknown): StepRecord[] {
  const raw = (output as { steps?: unknown } | null)?.steps;
  return Array.isArray(raw) ? (raw as StepRecord[]) : [];
}

function checksPassedOf(checks: unknown): boolean {
  if (!Array.isArray(checks) || checks.length === 0) return false;
  return checks.every(
    (check) =>
      typeof check === "object" &&
      check !== null &&
      (check as { pass?: unknown }).pass === true,
  );
}

/**
 * Re-scores a finished owner-benchmark run report under the per-item 3-vote
 * judge without mutating Postgres, preserving `ERROR`/`SKIPPED` results,
 * `score`, `totals`, `runtime`, and `jev` verbatim for `ownerbench-compare.mts`.
 */
export async function rejudgeEvalRunReport<
  T extends StoredEvalRunReportLike,
>(input: {
  report: T;
  journeys: readonly OwnerJourney[];
  privateSplitsPath?: string;
  judgeFn?: PerItemJudgeFn;
  concurrency?: number;
  onProgress?: (event: {
    completed: number;
    total: number;
    label: string;
    status: string;
  }) => void;
}): Promise<Omit<T, "cases"> & { cases: StoredEvalCaseReportLike[] }> {
  const journeyById = new Map(
    input.journeys.map((journey) => [journey.id, journey]),
  );
  const ownerCases = input.report.cases.filter((evalCase) =>
    evalCase.caseId.startsWith("owner-"),
  );
  const missingHoldout = ownerCases.some(
    (evalCase) =>
      evalCase.caseId.startsWith(HOLDOUT_PREFIX) &&
      !journeyById.has(evalCase.caseId),
  );
  if (missingHoldout)
    throw new Error(
      "This run contains held-out journeys; pass --holdout FILE and --splits FILE to re-judge it.",
    );
  const unknownDev = ownerCases
    .filter(
      (evalCase) =>
        !evalCase.caseId.startsWith(HOLDOUT_PREFIX) &&
        !journeyById.has(evalCase.caseId),
    )
    .map((evalCase) => evalCase.caseId);
  if (unknownDev.length)
    throw new Error(
      `Unknown owner-benchmark journeys in run: ${unknownDev.join(", ")}`,
    );

  // Validate every required split upfront before making any model calls.
  const activeJourneys = ownerCases.map(
    (evalCase) => journeyById.get(evalCase.caseId)!,
  );
  const splits = loadRubricSplitsForJourneys(
    activeJourneys,
    input.privateSplitsPath,
  );

  if (!input.judgeFn && sokoBotJudgeRunner() !== "claude-code") {
    throw new Error(
      "Local --rejudge requires SOKO_BOT_JUDGE_RUNNER=claude-code and refuses the paid AI Gateway.",
    );
  }

  const judgeFn: PerItemJudgeFn =
    input.judgeFn ??
    (({ journey, split, turnIds, roomLog }) =>
      judgeEvalChainPerItem({
        turnIds,
        scenario: journeyJudgeScenario(journey),
        roomLog,
        items: split.items,
        storeOnTurn: false,
        requireClaudeCode: true,
      }));

  const tasks: Array<{
    caseIndex: number;
    resultIndex: number;
    journey: OwnerJourney;
    split: JourneyRubricSplit;
    result: StoredEvalResultLike;
  }> = [];

  input.report.cases.forEach((evalCase, caseIndex) => {
    const journey = journeyById.get(evalCase.caseId);
    if (!journey) return;
    const split = splits.get(journey.id)!;
    evalCase.results.forEach((result, resultIndex) => {
      if (result.status !== "PASSED" && result.status !== "FAILED") return;
      tasks.push({ caseIndex, resultIndex, journey, split, result });
    });
  });

  const nextCases: StoredEvalCaseReportLike[] = input.report.cases.map(
    (evalCase) => ({
      ...evalCase,
      results: evalCase.results.map((result) => ({ ...result })),
    }),
  );

  const limit = pLimit(Math.max(1, input.concurrency ?? 2));
  let completed = 0;
  let holdoutCounter = 0;
  const holdoutIndexByCase = new Map<string, number>();

  await Promise.all(
    tasks.map((task) =>
      limit(async () => {
        const steps = storedStepsOf(task.result.output);
        const turnIds = steps.flatMap((step) => step.turnIds ?? []);
        if (turnIds.length === 0 && task.result.turnId)
          turnIds.push(task.result.turnId);
        const checksPass = checksPassedOf(task.result.checks);
        let judged: Awaited<ReturnType<PerItemJudgeFn>> | null = null;
        if (turnIds.length > 0) {
          judged = await judgeFn({
            journey: task.journey,
            split: task.split,
            turnIds,
            roomLog: journeyRoomLog(steps),
          }).catch(() => null);
        }
        const status = scoredJourneyStatus(
          checksPass,
          turnIds.length > 0,
          judged?.verdict ?? null,
        );
        const prevOutput =
          task.result.output &&
          typeof task.result.output === "object" &&
          !Array.isArray(task.result.output)
            ? (task.result.output as Record<string, unknown>)
            : {};
        nextCases[task.caseIndex]!.results[task.resultIndex] = {
          ...task.result,
          status,
          judge: judged?.verdict ?? null,
          judgeModel: judged?.model ?? null,
          error:
            status === "ERROR"
              ? "The per-item judge was unavailable, so the journey is unscored"
              : task.result.error,
          output: {
            ...prevOutput,
            judgeMode: "per-item",
            ...(judged ? { judgeItems: judged.items } : {}),
          },
        };
        completed += 1;
        if (input.onProgress) {
          const isHoldout = task.journey.id.startsWith(HOLDOUT_PREFIX);
          let label: string;
          if (isHoldout) {
            if (!holdoutIndexByCase.has(task.journey.id))
              holdoutIndexByCase.set(task.journey.id, ++holdoutCounter);
            label = `held-out #${holdoutIndexByCase.get(task.journey.id)} r${task.result.repeat}`;
          } else {
            label = `${task.journey.id} r${task.result.repeat}`;
          }
          input.onProgress({
            completed,
            total: tasks.length,
            label,
            status: isHoldout ? "scored" : status,
          });
        }
      }),
    ),
  );

  const updatedById = new Map<string, StoredEvalResultLike>();
  const updatedByCaseRepeat = new Map<string, StoredEvalResultLike>();

  for (const evalCase of nextCases) {
    if (!journeyById.has(evalCase.caseId)) continue;
    const states = evalCase.results.map((result) => result.status);
    const typedStates = asResultStates(states);
    evalCase.states = states;
    evalCase.passRate = passRate(typedStates);
    if ("outcome" in evalCase) {
      const scoredHistory = (evalCase.history ?? [])
        .slice(0, OUTCOME_BASELINE_WINDOW)
        .filter((rate): rate is number => typeof rate === "number");
      evalCase.outcome = evalOutcome(typedStates, scoredHistory);
    }
    for (const result of evalCase.results) {
      updatedById.set(result.id, result);
      updatedByCaseRepeat.set(`${result.caseId}:${result.repeat}`, result);
    }
  }

  const nextRun =
    "results" in input.report.run && Array.isArray(input.report.run.results)
      ? {
          ...input.report.run,
          results: input.report.run.results.map(
            (result) =>
              updatedById.get(result.id) ??
              updatedByCaseRepeat.get(`${result.caseId}:${result.repeat}`) ??
              result,
          ),
        }
      : input.report.run;

  const allResults = nextCases.flatMap((evalCase) => evalCase.results);
  const allStates = allResults.map((result) => result.status);
  const nextSummary = input.report.summary
    ? {
        ...input.report.summary,
        passed: allStates.filter((state) => state === "PASSED").length,
        scored: allStates.filter((state) =>
          ["PASSED", "FAILED", "ERROR"].includes(state),
        ).length,
        open: allStates.filter(
          (state) => state === "PENDING" || state === "RUNNING",
        ).length,
        passRate: caseWeightedPassRate(
          nextCases.map((evalCase) => evalCase.passRate),
        ),
        ...("counts" in input.report.summary
          ? {
              counts: countOutcomes(
                nextCases
                  .map((evalCase) => evalCase.outcome)
                  .filter(
                    (outcome): outcome is EvalOutcome => outcome !== undefined,
                  ),
              ),
            }
          : {}),
      }
    : undefined;

  return {
    ...input.report,
    run: nextRun,
    ...(nextSummary ? { summary: nextSummary } : {}),
    cases: nextCases,
  };
}
