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
      let response: Response | undefined;
      let stalled: boolean;
      try {
        response = await fetch(url, {
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
        stalled = response.status === 503;
      } catch {
        // Anything thrown here is the request not completing: a dropped
        // connection, a truncated body, or the redirect that `redirect: "error"`
        // refused. That is what a deployment rollover looks like from the
        // browser, so it retries like a 503. Our own deadline firing lands here
        // too, and `wait` below turns it into `null` on the spot.
        stalled = true;
      }

      // Parsing runs outside the retry decision. A body that will not parse is
      // an answer, however wrong, so it fails through to `null` on one attempt
      // rather than costing three requests.
      if (response?.ok) return await response.json();

      const retryDelay = stalled
        ? RETRY_DELAYS_ON_UNAVAILABLE_MS[attempt]
        : undefined;
      if (retryDelay === undefined) return null;

      await wait(retryDelay, controller.signal);
    }
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}
