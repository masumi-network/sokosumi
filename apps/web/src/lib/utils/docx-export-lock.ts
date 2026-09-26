/**
 * Serializes DOCX export conversions inside one server instance.
 *
 * The conversion pipeline replaces process globals: `withDocxExportFetchGuard`
 * swaps `globalThis.fetch` and `setupDomContext` swaps `window` / `document` /
 * `HTMLElement` / `SVGElement`. It does so because `mdast2docx` and the
 * `@m2d/*` plugins read those globals ambiently and accept no injected `fetch`
 * or `Window`. Fluid Compute reuses one function instance across concurrent
 * requests, so two overlapping exports would trade guards and delete each
 * other's DOM mid-conversion.
 *
 * Running one conversion at a time per instance is the only safe execution
 * while those globals stay ambient. It trades export throughput for
 * correctness (SOK-1017).
 *
 * It bounds exports against each other only. While a conversion runs, the
 * swapped `globalThis.fetch` still reaches unrelated requests on the same
 * instance, which is what SOK-1121 removes.
 */
export const DOCX_QUEUE_WAIT_TIMEOUT_MS = 10_000;

export class DocxExportQueueError extends Error {}

let locked = false;
const waiters = new Set<() => void>();

export function withDocxExportLock<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const deadline = Date.now() + DOCX_QUEUE_WAIT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function cleanupWait() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      waiters.delete(start);
    }

    function cancel(message: string) {
      cleanupWait();
      reject(new DocxExportQueueError(message));
    }

    function abort() {
      cancel("Export request canceled");
    }

    async function run() {
      try {
        resolve(await fn());
      } catch (error) {
        reject(error);
      } finally {
        locked = false;
        // Skip expired waiters even if their timers have not fired yet.
        while (!locked && waiters.size > 0) {
          waiters.values().next().value?.();
        }
      }
    }

    function start() {
      cleanupWait();
      if (signal?.aborted) {
        abort();
      } else if (Date.now() >= deadline) {
        cancel("Export queue wait expired");
      } else {
        locked = true;
        // Cancellation only applies while queued. Active conversion owns globals
        // until its cleanup finishes, even if the client has disconnected.
        void run();
      }
    }

    if (signal?.aborted) {
      abort();
    } else if (!locked) {
      start();
    } else {
      waiters.add(start);
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => cancel("Export queue wait expired"),
        DOCX_QUEUE_WAIT_TIMEOUT_MS,
      );
    }
  });
}
