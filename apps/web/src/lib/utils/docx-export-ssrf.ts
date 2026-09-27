import { AsyncLocalStorage } from "node:async_hooks";
import { ssrfSafeFetch } from "@sokosumi/net";

import {
  MAX_DOCX_IMAGES,
  MAX_DOCX_REMOTE_IMAGE_BYTES,
} from "@/lib/utils/docx-export-budget";
import { ExportLimitError } from "@/lib/utils/export-operation";

/** Hard cap on each remote image fetched during DOCX export. */
export const MAX_DOCX_IMAGE_BYTES = 5_000_000;

/**
 * Wall-clock cap on each remote image fetch during DOCX export.
 *
 * A host that accepts the connection and then never answers would otherwise
 * hang the whole conversion, and the conversion holds the per-instance export
 * lock (see `docx-export-lock.ts`). `ssrfSafeFetch` sets no timeout of its own
 * and `@m2d/image` calls `fetch` with no init, so the cap has to come from here.
 */
export const DOCX_IMAGE_FETCH_TIMEOUT_MS = 10_000;

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
  signal?: AbortSignal,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const fetchContext = new AsyncLocalStorage<boolean>();
  const budgetController = new AbortController();
  const guardSignal = AbortSignal.any([
    budgetController.signal,
    ...(signal ? [signal] : []),
  ]);
  let imageCount = 0;
  let imageBytes = 0;
  let budgetError: ExportLimitError | undefined;

  function exceedBudget(message: string): never {
    budgetError ??= new ExportLimitError(message);
    budgetController.abort(budgetError);
    throw budgetError;
  }

  function onResponseBytes(bytes: number): void {
    imageBytes += bytes;
    if (imageBytes > MAX_DOCX_REMOTE_IMAGE_BYTES) {
      exceedBudget("DOCX remote image bytes exceed limit");
    }
  }

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    // Concurrent requests must not consume this document's image budget.
    if (!fetchContext.getStore()) return originalFetch(input, init);
    guardSignal.throwIfAborted();
    const url = resolveFetchUrl(input);
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      return originalFetch(input, init);
    }

    imageCount += 1;
    if (imageCount > MAX_DOCX_IMAGES) {
      exceedBudget("DOCX image fetch count exceeds limit");
    }
    const requestSignal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      throw new Error(`DOCX export blocked non-safe fetch method: ${method}`);
    }

    return ssrfSafeFetch(url, {
      method,
      maxResponseBytes: MAX_DOCX_IMAGE_BYTES,
      onResponseBytes,
      signal: AbortSignal.any([
        guardSignal,
        AbortSignal.timeout(DOCX_IMAGE_FETCH_TIMEOUT_MS),
        ...(requestSignal ? [requestSignal] : []),
      ]),
    });
  };

  try {
    guardSignal.throwIfAborted();
    const result = await fetchContext.run(true, fn);
    // The image plugin turns fetch errors into placeholders. Limits must still
    // reject the whole document after every image task has settled.
    if (budgetError) throw budgetError;
    guardSignal.throwIfAborted();
    return result;
  } catch (error) {
    if (budgetError) throw budgetError;
    guardSignal.throwIfAborted();
    throw error;
  } finally {
    fetchContext.disable();
    globalThis.fetch = originalFetch;
  }
}
