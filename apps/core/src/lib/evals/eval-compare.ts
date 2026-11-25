/**
 * How one case did in a run, against the daily runs on main before it.
 *
 * - regressed: it passed every repeat of the last daily runs and most of its
 *   repeats fail now (one failed repeat of two is flaky: a judge can flip)
 * - fixed: it failed every repeat of the last daily run and passes now
 * - flaky: it passes some repeats, and its history already shows failures
 * - failing: it failed before and fails now
 * - passing: it passes every repeat
 * - error: it could not be run or scored, every repeat
 *   Also used for partial execution errors when no behavior check failed.
 * - pending: no repeat has finished yet
 * - skipped: this environment cannot run it
 *
 * Without the split every red case looks equally urgent, and people stop
 * looking at red.
 */
export type EvalOutcome =
  | "regressed"
  | "fixed"
  | "flaky"
  | "failing"
  | "passing"
  | "error"
  | "pending"
  | "skipped";

export type EvalResultState =
  | "PENDING"
  | "RUNNING"
  | "PASSED"
  | "FAILED"
  | "ERROR"
  | "SKIPPED";

/** Share of scored repeats that passed; null when none was scored. */
export function passRate(states: readonly EvalResultState[]): number | null {
  const scored = states.filter(
    (state) => state === "PASSED" || state === "FAILED" || state === "ERROR",
  );
  if (scored.length === 0) return null;
  return scored.filter((state) => state === "PASSED").length / scored.length;
}

/**
 * `history` holds the case's pass rate in earlier daily runs, newest first;
 * the first is the baseline. A run where the case was not scored is left out.
 */
export function evalOutcome(
  states: readonly EvalResultState[],
  history: readonly number[],
): EvalOutcome {
  if (states.length > 0 && states.every((state) => state === "SKIPPED"))
    return "skipped";
  const scored = states.filter((state) => state !== "SKIPPED");
  // An unavailable provider is not evidence that a passing behavior regressed.
  // Preserve genuine FAILED checks even when another repeat could not execute.
  if (scored.includes("ERROR") && !scored.includes("FAILED")) return "error";
  const rate = passRate(states);
  if (rate === null) return "pending";
  const baseline = history[0];
  const alwaysPassed = history.length > 0 && history.every((r) => r === 1);
  if (rate === 1) return baseline === 0 ? "fixed" : "passing";
  if (baseline === undefined) return rate === 0 ? "failing" : "flaky";
  if (rate === 0) return baseline === 0 ? "failing" : "regressed";
  return alwaysPassed && rate < 0.5 ? "regressed" : "flaky";
}

/** A case costs or takes more than this many times its usual run. */
export const USUAL_RATIO = 1.3;
/** Weekly runs the usual value is the median of. */
export const USUAL_WINDOW = 5;
/** Fewer weekly runs than this say nothing about what is usual. */
export const USUAL_MIN_RUNS = 3;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The median of the last weekly runs, newest first; null without enough of them. */
export function usualValue(history: readonly number[]): number | null {
  const recent = history.slice(0, USUAL_WINDOW);
  return recent.length < USUAL_MIN_RUNS ? null : median(recent);
}

/** Whether `value` is more than `USUAL_RATIO` times the usual one. */
export function aboveUsual(
  value: number | null,
  usual: number | null,
): boolean {
  return (
    value !== null && usual !== null && usual > 0 && value > usual * USUAL_RATIO
  );
}

export const EVAL_OUTCOME_ORDER: readonly EvalOutcome[] = [
  "regressed",
  "error",
  "failing",
  "flaky",
  "fixed",
  "passing",
  "pending",
  "skipped",
];

export type EvalOutcomeCounts = Record<EvalOutcome, number>;

export function countOutcomes(
  outcomes: readonly EvalOutcome[],
): EvalOutcomeCounts {
  const counts = Object.fromEntries(
    EVAL_OUTCOME_ORDER.map((outcome) => [outcome, 0]),
  ) as EvalOutcomeCounts;
  for (const outcome of outcomes) counts[outcome] += 1;
  return counts;
}
