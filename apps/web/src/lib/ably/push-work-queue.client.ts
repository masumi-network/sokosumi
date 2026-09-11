"use client";

/** Everything that changes this browser's push state, in the order asked. */
let pushWork: Promise<unknown> = Promise.resolve();
let pending = 0;
let teardowns = 0;

/**
 * Run this after whatever is already changing this browser's push state.
 *
 * Turning push on deactivates the shared Ably client halfway through, so two
 * runs beside each other leave the browser subscribed with no device
 * registered: the page reads push as on and nothing is ever delivered.
 * Turning it off beside a run that is turning it on is worse still, because
 * the run finishes afterwards and the reader who signed out or pressed the
 * cell off is subscribed again. Order them instead, so the last thing the
 * reader asked for is the last thing that happens.
 *
 * A failed run does not stop the next one: what follows is usually the repair
 * for it.
 */
export function queuePushWork<T>(work: () => Promise<T>): Promise<T> {
  pending += 1;

  // Called with no argument of its own. `then` hands a settled value or a
  // reason to whatever it calls, and the work here answers for the reader's
  // request rather than for the run before it.
  const next = pushWork.then(
    () => work(),
    () => work(),
  );
  const settled = next.then(
    () => {},
    () => {},
  );
  pushWork = settled;
  void settled.then(() => {
    pending -= 1;
  });

  return next;
}

/**
 * Whether this browser's push state is being changed right now.
 *
 * Asked by a caller that would otherwise read that state itself and act on
 * what it saw. Halfway through turning push on, the browser carries neither a
 * subscription nor a registration: the activation clears both to go round
 * again. A reader signing out in that window reads an untouched browser and
 * leaves the run to finish behind them, which subscribes the browser they just
 * signed out of. This says the reads mean nothing yet.
 *
 * A run that never finishes says pending for the life of the page, and that is
 * the answer to keep. One step can hang there: `pushManager.subscribe()` is
 * allowed to stay pending when the push service cannot be reached, and nothing
 * rejects it. Believing it costs a sign-out the wait its own cap allows it.
 * Giving up on it instead hands the caller the browser's own reads, which say
 * push was never on while an activation is halfway through clearing them, and
 * the reader is subscribed again behind their own sign-out. The wait is the
 * cheaper of the two.
 *
 * Kept here rather than in the module that runs the work, so a page that never
 * turned push on can ask without loading the Ably SDK.
 */
export function isPushWorkPending(): boolean {
  return pending > 0;
}

/**
 * That the reader has asked for push off since the page loaded, counted.
 *
 * An unattended repair decides to act from what it reads, then waits on a
 * dynamic import before it can queue anything. A sign-out inside that window
 * finds nothing queued, tears down, and leaves: the repair then subscribes the
 * browser the reader just signed out of, because ordering only orders what has
 * already been asked for. Reading this before and after the wait is how the
 * repair notices it is no longer wanted.
 */
export function countPushTeardowns(): number {
  return teardowns;
}

/** Say that push is being turned off, before the teardown is queued. */
export function notePushTeardown(): void {
  teardowns += 1;
}
