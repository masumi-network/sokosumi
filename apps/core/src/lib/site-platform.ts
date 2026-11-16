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

/** The homepage's headers and HTML; null when it cannot be read. */
export async function readHomepage(
  rawUrl: string,
): Promise<{ headers: Headers; html: string } | null> {
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
    return { headers: response.headers, html: await response.text() };
  } catch {
    return null;
  }
}

/** Reads the homepage once; null when it cannot be read, so a later try can. */
export async function detectSitePlatform(
  rawUrl: string,
): Promise<SitePlatform | null> {
  const page = await readHomepage(rawUrl);
  return page ? sitePlatformOf(page.headers, page.html) : null;
}

/** The language a page declares, in English ("German"); null when it declares none. */
export function siteLanguageOf(html: string): string | null {
  const code = html.match(/<html\b[^>]*\blang=["']?([a-z]{2,3})\b/i)?.[1];
  if (!code) return null;
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "language" }).of(
        code.toLowerCase(),
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** The language the homepage is written in; null when it cannot tell. */
export async function detectSiteLanguage(
  rawUrl: string,
): Promise<string | null> {
  const page = await readHomepage(rawUrl);
  return page ? siteLanguageOf(page.html) : null;
}
