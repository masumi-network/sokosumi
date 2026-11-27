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
  judgeEvalChain,
  judgeEvalChainPerItem,
  type PerItemJudgeItemResult,
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
  states: string[];
  passRate: number | null;
  results: R[];
}

export interface StoredEvalRunReportLike<
  C extends StoredEvalCaseReportLike = StoredEvalCaseReportLike,
> {
  run: object;
  cases: C[];
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

  const judgeFn: PerItemJudgeFn =
    input.judgeFn ??
    (({ journey, split, turnIds, roomLog }) =>
      judgeEvalChainPerItem({
        turnIds,
        scenario: journeyJudgeScenario(journey),
        roomLog,
        items: split.items,
        storeOnTurn: false,
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

  for (const evalCase of nextCases) {
    if (!journeyById.has(evalCase.caseId)) continue;
    evalCase.states = evalCase.results.map((result) => result.status);
    const scored = evalCase.results.filter(
      (result) => result.status === "PASSED" || result.status === "FAILED",
    );
    evalCase.passRate =
      scored.length > 0
        ? scored.filter((result) => result.status === "PASSED").length /
          scored.length
        : null;
  }

  return {
    ...input.report,
    cases: nextCases,
  };
}
