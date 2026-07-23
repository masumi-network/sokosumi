import { assertPublicResolvedHttpUrl, SsrfError } from "@sokosumi/net";
import type { HTTPRequest, Page } from "puppeteer-core";

const ALLOWED_LOCAL_SCHEMES = ["data:", "blob:", "about:blank"] as const;

/**
 * True when Chromium may load the URL without an outbound network check
 * (inline documents / blank frames).
 */
export function isAllowedLocalBrowserUrl(url: string): boolean {
  return ALLOWED_LOCAL_SCHEMES.some(
    (scheme) => url === scheme || url.startsWith(scheme),
  );
}

/**
 * Validates that a browser navigation/resource URL is safe to fetch from the
 * PDF export Chromium instance (http(s) only; no private/link-local targets).
 */
export async function assertSafePdfResourceUrl(url: string): Promise<void> {
  if (isAllowedLocalBrowserUrl(url)) {
    return;
  }

  try {
    await assertPublicResolvedHttpUrl(url);
  } catch (error) {
    if (error instanceof SsrfError) {
      throw error;
    }
    throw new SsrfError(`Unsafe PDF resource URL: ${url}`);
  }
}

/**
 * Install request interception that aborts non-local URLs failing the SSRF
 * guard. Must be called after `page.setRequestInterception(true)`.
 */
export function installPdfExportRequestGuard(page: Page): void {
  page.on("request", (request: HTTPRequest) => {
    void (async () => {
      try {
        await assertSafePdfResourceUrl(request.url());
        await request.continue();
      } catch {
        await request.abort("blockedbyclient").catch(() => {});
      }
    })();
  });
}
