/**
 * Background GET of a web route that mirrors a Core read (SOK-986). Outside
 * the server action queue; bounded; null on any failure, redirect, or
 * non-2xx so a late or failed read never replaces newer local data.
 */

/**
 * Spaced retries for 503 only. The background chat routes answer 503 when the
 * Core session read could not complete, which is "ask again", not "no" — those
 * stalls clear in seconds. Every other status stays a single attempt: a 401 is
 * an answer, and retrying a 502 only doubles the load on something already
 * struggling.
 *
 * Both retries run inside the caller's existing deadline, so the total wait is
 * still bounded by `timeoutMs`.
 */
const RETRY_DELAYS_ON_UNAVAILABLE_MS = [1_000, 3_000];

function wait(ms: number, signal: AbortSignal): Promise<void> {
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
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      // `redirect: "error"` already rejects any redirect, so only status remains.
      if (response.ok) return await response.json();

      const retryDelay =
        response.status === 503
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
