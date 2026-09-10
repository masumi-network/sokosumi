/**
 * Background GET of a web route that mirrors a Core read (SOK-986). Outside
 * the server action queue; bounded; null on any failure, redirect, or non-2xx
 * so a late or failed read never replaces newer local data. A stall retries
 * first, so "null" can arrive up to four seconds later than the first attempt.
 */

/**
 * Spaced retries for a stall: a 503 from the route, or a request that never
 * completed at all. Both mean Core could not be asked, which is "ask again",
 * not "no", and they clear in seconds. Every answered status stays a single
 * attempt: a 401 is an answer, and retrying a 502 only doubles the load on
 * something already struggling.
 *
 * Both retries run inside the caller's existing deadline, so the total wait is
 * still bounded by `timeoutMs`.
 */
const RETRY_DELAYS_ON_UNAVAILABLE_MS = [1_000, 3_000];

/**
 * Spread of the jitter applied to each delay, as a fraction of it.
 *
 * Several readers stall together — three sidebar collections plus the unread
 * bell all poll on the same tick — so a fixed delay has them retry in lockstep
 * and hit the recovering function as one burst. A quarter is enough to spread
 * them without letting the last retry drift near the caller's deadline.
 */
const RETRY_JITTER_FRACTION = 0.25;

function jittered(delayMs: number): number {
  const spread = delayMs * RETRY_JITTER_FRACTION;
  return Math.round(delayMs - spread + Math.random() * spread * 2);
}

/**
 * Per-attempt ceiling, so a request that never answers at all still reaches the
 * retry loop. Without it one hung attempt spends the caller's whole budget and
 * nothing is ever retried: the route has no timeout of its own around the Core
 * read (`core.request.ts`), so it can hang past any of these deadlines.
 *
 * 9s sits above the route's own 8s session-read budget, so a slow but living
 * read is never killed for being slow, and below the smallest caller budget
 * (20s in `fetch-sidebar-room-collection.ts`) by enough for one full retry.
 */
const ATTEMPT_STALL_TIMEOUT_MS = 9_000;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  // A signal that is already aborted never fires an `abort` event, so the
  // listener below would never run and the wait would outlive the caller's
  // deadline. This is also the single place the spent deadline ends the loop.
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchBackgroundJson(
  url: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let attempt = 0; ; attempt++) {
      const attemptController = new AbortController();
      const attemptTimer = window.setTimeout(
        () => attemptController.abort(),
        ATTEMPT_STALL_TIMEOUT_MS,
      );
      let stalled: boolean;
      try {
        const response = await fetch(url, {
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([
            controller.signal,
            attemptController.signal,
          ]),
        });

        // The body is read under the same attempt ceiling as the headers. A
        // route that answers and then stalls mid-body is the same stall, and
        // reading it outside the ceiling gave it the caller's whole budget.
        if (response.ok) {
          try {
            return await response.json();
          } catch (error) {
            // A body that will not parse is an answer, however wrong, so it
            // costs one attempt. A body that never arrived is a stall, so it
            // falls through to the retry below.
            if (error instanceof SyntaxError) return null;
            throw error;
          }
        }
        stalled = response.status === 503;
      } catch {
        // Anything thrown here is the request not completing: a dropped
        // connection, a truncated body, or the redirect that `redirect: "error"`
        // refused. That is what a deployment rollover looks like from the
        // browser, so it retries like a 503. Our own deadline firing lands here
        // too, and `wait` below turns it into `null` on the spot.
        stalled = true;
      } finally {
        window.clearTimeout(attemptTimer);
      }

      const retryDelay = stalled
        ? RETRY_DELAYS_ON_UNAVAILABLE_MS[attempt]
        : undefined;
      if (retryDelay === undefined) return null;

      await wait(jittered(retryDelay), controller.signal);
    }
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}
