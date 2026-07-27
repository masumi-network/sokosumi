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
 *
 * Two independent valves:
 * 1. **Fail-open** — temporary local clear after N failed background polls;
 *    the next successful fetch may reassert `true` if the server still is.
 * 2. **Max-age ceiling** — hard suppress after 8 min continuously true; once
 *    armed, successful polls keep `transitioning` false until the server
 *    reports `false` (so a stuck server cannot re-latch the banner).
 */

/** Clear a latched `transitioning` after this many consecutive failed
 * background refreshes. Three because a single hiccup is noise; three in a
 * row (≥90s at the 30s cadence) means we can no longer trust the flag. */
export const TRANSITIONING_FAILURE_CLEAR_THRESHOLD = 3;

/** Hard ceiling on how long the banner may stay up: 2× the orchestrator's
 * ~4-min capability-roll cap. Consumed as a `setTimeout` delay anchored to
 * when the flag flipped true; past this, drop it and suppress server reassert
 * until the orchestrator reports false. */
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

/**
 * Apply a server instance snapshot under the max-age ceiling.
 *
 * When `maxAgeSuppressed` is true, force `transitioning: false` even if the
 * server still reports true — until the server reports false (which lifts
 * suppression so a later legitimate roll can show the banner again).
 */
export function withTransitioningCeiling<T extends { transitioning: boolean }>(
  data: T,
  maxAgeSuppressed: boolean,
): { data: T; maxAgeSuppressed: boolean } {
  if (!data.transitioning) {
    return { data, maxAgeSuppressed: false };
  }
  if (!maxAgeSuppressed) {
    return { data, maxAgeSuppressed: false };
  }
  return {
    data: { ...data, transitioning: false },
    maxAgeSuppressed: true,
  };
}
