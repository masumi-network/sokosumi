import { ssrfSafeFetch } from "@sokosumi/net";

import {
  type ChatRoomMessageUnfurlCard,
  parseOpenGraphFields,
  toUnfurlCard,
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
const REQUEST_HEADERS = {
  "User-Agent":
    "facebookexternalhit/1.1; SokosumiBot/1.0 (+https://sokosumi.com)",
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Language": "en",
} as const;

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
