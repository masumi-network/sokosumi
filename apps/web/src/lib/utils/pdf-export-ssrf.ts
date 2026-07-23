import { ssrfSafeFetch } from "@sokosumi/net";
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

async function handlePdfExportRequest(request: HTTPRequest): Promise<void> {
  try {
    const url = request.url();
    if (isAllowedLocalBrowserUrl(url)) {
      await request.continue();
      return;
    }

    const method = request.method().toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      await request.abort("blockedbyclient");
      return;
    }

    // Fetch in-process with connect-time address filtering so DNS rebinding
    // between check and Chromium connect cannot open private targets.
    const response = await ssrfSafeFetch(url, { method });
    const body = Buffer.from(await response.arrayBuffer());
    await request.respond({
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
      headers: responseHeadersForPuppeteer(response),
      body,
    });
  } catch {
    await request.abort("blockedbyclient").catch(() => {});
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
