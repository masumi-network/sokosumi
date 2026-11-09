/**
 * How one case did in a run, against the daily runs on main before it.
 *
 * - regressed: it passed every repeat of the last daily runs and fails now
 *   (all repeats, or any repeat when its history never failed)
 * - fixed: it failed every repeat of the last daily run and passes now
 * - flaky: it passes some repeats, and its history already shows failures
 * - failing: it failed before and fails now
 * - passing: it passes every repeat
 * - error: it could not be run or scored, every repeat
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
  if (scored.length > 0 && scored.every((state) => state === "ERROR"))
    return "error";
  const rate = passRate(states);
  if (rate === null) return "pending";
  const baseline = history[0];
  const alwaysPassed = history.length > 0 && history.every((r) => r === 1);
  if (rate === 1) return baseline === 0 ? "fixed" : "passing";
  if (baseline === undefined) return rate === 0 ? "failing" : "flaky";
  if (rate === 0) return baseline === 0 ? "failing" : "regressed";
  return alwaysPassed ? "regressed" : "flaky";
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
