import { ssrfSafeFetch } from "@sokosumi/net";

const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 8_000;

/** Markers every Shopify storefront serves in its homepage or headers. */
const SHOPIFY_HTML =
  /cdn\.shopify\.com|\.myshopify\.com|Shopify\.theme|shopify-section/i;

/** Shop systems Cuso can measure; anything else is "other". */
export type SitePlatform = "shopify" | "other";

/** Whether the page is a Shopify storefront, from its headers and HTML. */
export function sitePlatformOf(headers: Headers, html: string): SitePlatform {
  if (
    headers.get("x-shopid") ||
    /shopify/i.test(headers.get("powered-by") ?? "")
  )
    return "shopify";
  return SHOPIFY_HTML.test(html) ? "shopify" : "other";
}

/** Reads the homepage once; null when it cannot be read, so a later try can. */
export async function detectSitePlatform(
  rawUrl: string,
): Promise<SitePlatform | null> {
  try {
    const url = new URL(
      /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`,
    );
    const response = await ssrfSafeFetch(url.toString(), {
      headers: {
        "User-Agent": "SokosumiBot/1.0 (+https://sokosumi.com)",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      maxResponseBytes: MAX_PAGE_BYTES,
    });
    if (!response.ok) return null;
    return sitePlatformOf(response.headers, await response.text());
  } catch {
    return null;
  }
}
