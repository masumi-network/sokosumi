/**
 * Client-side safety valves for the "your assistant is applying your change…"
 * banner (`instance.transitioning`), which disables the chat composer while a
 * capability roll restarts the orchestrator (~30–60s).
 *
 * The flag only refreshes on the 30s running-state poll, and that poll skips
 * updating the instance on a failed/transient fetch — so a `transitioning:true`
 * value can latch forever if background refreshes keep failing or a
 * backgrounded tab throttles the timer. These helpers time-box it so a dropped
 * poll never permanently disables the composer. UI-only; the orchestrator is
 * unchanged.
 */

/** Clear a latched `transitioning` after this many consecutive failed
 * background refreshes. Three because a single hiccup is noise; three in a
 * row (≥90s at the 30s cadence) means we can no longer trust the flag. */
export const TRANSITIONING_FAILURE_CLEAR_THRESHOLD = 3;

/** Hard ceiling on how long the banner may stay up: 2× the orchestrator's
 * ~4-min capability-roll cap. Consumed as a `setTimeout` delay anchored to
 * when the flag flipped true; past this, drop it regardless — a real roll is
 * long over. */
export const TRANSITIONING_MAX_AGE_MS = 8 * 60_000;

/**
 * Fail-open: once background refreshes have failed this many times in a row,
 * a stale `transitioning: true` should be cleared locally rather than held.
 */
export function shouldClearTransitioningAfterFailures(
  consecutiveFailures: number,
): boolean {
  return consecutiveFailures >= TRANSITIONING_FAILURE_CLEAR_THRESHOLD;
}
