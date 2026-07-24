import { ssrfSafeFetch } from "@sokosumi/net";

/** Hard cap on each remote image fetched during DOCX export. */
export const MAX_DOCX_IMAGE_BYTES = 5_000_000;

/** Hard cap on the DOCX export JSON body (markdown + optional logos). */
export const MAX_MARKDOWN_BYTES = 1_500_000;

function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/**
 * Runs `fn` with `globalThis.fetch` wrapped so http(s) requests go through
 * {@link ssrfSafeFetch} (connect-time private-network filter + response cap).
 * Restores the original `fetch` afterward even if `fn` throws.
 *
 * Used around `@m2d/image` DOCX conversion, which calls `fetch` for remote
 * markdown image URLs with no SSRF controls of its own.
 */
export async function withDocxExportFetchGuard<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = resolveFetchUrl(input);
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return originalFetch(input, init);
    }

    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      throw new Error(`DOCX export blocked non-safe fetch method: ${method}`);
    }

    return ssrfSafeFetch(url, {
      method,
      maxResponseBytes: MAX_DOCX_IMAGE_BYTES,
      signal: init?.signal ?? undefined,
    });
  };

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
