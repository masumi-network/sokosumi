import { ssrfSafeFetch } from "@sokosumi/net";

import {
  type ChatRoomMessageUnfurlCard,
  parseOpenGraphFields,
  toUnfurlCard,
  tweetTextFromOembedHtml,
} from "@/lib/open-graph-html";

/** Transfer cap for unfurl pages (abuse bound; marketing pages can be large). */
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
/** Per-URL budget so a slow host cannot stall the whole pipeline. */
const PAGE_TIMEOUT_MS = 8_000;
/** Parallel scrapes within one message (max 3 candidates). */
const SCRAPE_CONCURRENCY = 2;

/**
 * Link-preview UA that major sites (YouTube, etc.) whitelist for OG tags.
 * Plain SokosumiBot alone gets bot interstitials without og:title.
 * Keep SokosumiBot in the string so operators can still identify us.
 */
export const UNFURL_USER_AGENT =
  "facebookexternalhit/1.1; SokosumiBot/1.0 (+https://sokosumi.com)";

const REQUEST_HEADERS = {
  "User-Agent": UNFURL_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Language": "en",
} as const;

/** oEmbed payloads are a few KB; anything larger is not one. */
const MAX_OEMBED_BYTES = 64 * 1024;

const X_STATUS_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);

/**
 * Canonical `https://x.com/<user>/status/<id>` for an X / Twitter status
 * URL (query, host variants, and `/photo/1`-style sub-paths dropped), or
 * null for anything else.
 */
function xStatusCanonicalUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!X_STATUS_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const match = parsed.pathname.match(
    /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/|$)/,
  );
  if (!match) return null;
  return `https://x.com/${match[1]}/status/${match[2]}`;
}

/**
 * Tweet text via X's public oEmbed endpoint. X serves an empty
 * `og:description`, and its `og:image` host returns 403 to browsers that
 * carry an X login cookie, so without this the card is image-only and
 * vanishes client-side for exactly the people who share X links.
 * Silent on any failure.
 */
async function fetchXStatusText(statusUrl: string): Promise<string | null> {
  const oembedUrl = new URL("https://publish.x.com/oembed");
  oembedUrl.searchParams.set("url", statusUrl);
  oembedUrl.searchParams.set("omit_script", "1");

  let response: Response;
  try {
    response = await ssrfSafeFetch(oembedUrl.toString(), {
      headers: { ...REQUEST_HEADERS, Accept: "application/json" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      maxResponseBytes: MAX_OEMBED_BYTES,
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  const html =
    payload && typeof payload === "object" && "html" in payload
      ? (payload as { html?: unknown }).html
      : null;
  return typeof html === "string" ? tweetTextFromOembedHtml(html) : null;
}

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  return mime === "text/html" || mime === "application/xhtml+xml";
}

/**
 * SSRF-safe GET of one URL; parse OG; return card or null.
 * Silent on SSRF reject, timeout, non-OK, non-HTML, parse miss.
 */
export async function scrapeOneUnfurlCard(
  url: string,
): Promise<ChatRoomMessageUnfurlCard | null> {
  let response: Response;
  try {
    response = await ssrfSafeFetch(url, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      maxResponseBytes: MAX_PAGE_BYTES,
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;
  if (!isHtmlContentType(response.headers.get("content-type"))) return null;

  let html: string;
  try {
    html = await response.text();
  } catch {
    return null;
  }

  const fields = parseOpenGraphFields(html);
  const xStatusUrl = xStatusCanonicalUrl(url);
  if (xStatusUrl && !fields.description) {
    fields.description = await fetchXStatusText(xStatusUrl);
  }
  return toUnfurlCard(fields, url, url);
}

/**
 * Scrape candidates in order; skip nulls; preserve success order.
 * Cap already applied by `selectUnfurlCandidateUrls`.
 */
export async function scrapeUnfurlCards(
  urls: readonly string[],
): Promise<ChatRoomMessageUnfurlCard[]> {
  if (urls.length === 0) return [];

  const results: Array<ChatRoomMessageUnfurlCard | null> = new Array(
    urls.length,
  ).fill(null);

  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < urls.length) {
      const index = nextIndex;
      nextIndex += 1;
      const url = urls[index]!;
      results[index] = await scrapeOneUnfurlCard(url);
    }
  }

  const workers = Array.from(
    { length: Math.min(SCRAPE_CONCURRENCY, urls.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return results.filter(
    (card): card is ChatRoomMessageUnfurlCard => card != null,
  );
}
