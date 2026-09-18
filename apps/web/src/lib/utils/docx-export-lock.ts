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
let queue: Promise<void> = Promise.resolve();

export function withDocxExportLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
