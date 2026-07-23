import { ssrfSafeFetch } from "@sokosumi/net";
import type { HTTPRequest, Page } from "puppeteer-core";

const ALLOWED_LOCAL_SCHEMES = ["data:", "blob:", "about:blank"] as const;

/** Hard cap on each remote resource Chromium would load during PDF export. */
export const MAX_PDF_RESOURCE_BYTES = 5_000_000;

/**
 * True when Chromium may load the URL without an outbound network check
 * (inline documents / blank frames).
 */
export function isAllowedLocalBrowserUrl(url: string): boolean {
  return ALLOWED_LOCAL_SCHEMES.some(
    (scheme) => url === scheme || url.startsWith(scheme),
  );
}

/** Origin + pathname only — strip query/fragment (may hold secrets). */
export function redactUrlForLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[unparseable-url]";
  }
}

function responseHeadersForPuppeteer(
  response: Response,
): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    // Hop-by-hop / framing headers must not be forwarded into Chromium.
    const lower = key.toLowerCase();
    if (
      lower === "content-encoding" ||
      lower === "content-length" ||
      lower === "transfer-encoding" ||
      lower === "connection"
    ) {
      return;
    }
    headers[key] = value;
  });
  return headers;
}

async function abortBlockedRequest(
  request: HTTPRequest,
  reason: string,
  url: string,
): Promise<void> {
  console.warn("[pdf-export-ssrf] blocked request", {
    reason,
    url: redactUrlForLog(url),
  });
  await request.abort("blockedbyclient").catch(() => {});
}

async function handlePdfExportRequest(request: HTTPRequest): Promise<void> {
  const url = request.url();
  try {
    if (isAllowedLocalBrowserUrl(url)) {
      await request.continue();
      return;
    }

    const method = request.method().toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      await abortBlockedRequest(request, "method_not_allowed", url);
      return;
    }

    // Fetch in-process with connect-time address filtering so DNS rebinding
    // between check and Chromium connect cannot open private targets.
    // Intentionally do NOT forward Chromium cookies / Authorization — that
    // would widen SSRF blast radius to the caller's credentials.
    const response = await ssrfSafeFetch(url, {
      method,
      maxResponseBytes: MAX_PDF_RESOURCE_BYTES,
    });
    const body = Buffer.from(await response.arrayBuffer());
    await request.respond({
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
      headers: responseHeadersForPuppeteer(response),
      body,
    });
  } catch {
    await abortBlockedRequest(request, "ssrf_or_fetch_failed", url);
  }
}

/**
 * Install request interception that fulfills http(s) via {@link ssrfSafeFetch}
 * (connect-time SSRF filter) and aborts anything else unsafe.
 * Must be called after `page.setRequestInterception(true)`.
 */
export function installPdfExportRequestGuard(page: Page): void {
  page.on("request", (request: HTTPRequest) => {
    void handlePdfExportRequest(request);
  });
}
