import { isFileLikeUrl } from "./file-url.js";
import {
  findMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "./markdown-links.js";
import { findBareHttpUrlHits, findHttpAutolinks } from "./markdown-url-scan.js";

const MAX_UNFURL_CANDIDATES = 3;

interface UrlHit {
  url: string;
  index: number;
}

function isEligibleHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return !isFileLikeUrl(url);
  } catch {
    return false;
  }
}

function collectUrlHits(markdown: string): UrlHit[] {
  const hits: UrlHit[] = [];

  for (const link of findMarkdownLinks(markdown)) {
    hits.push({
      url: unescapeMarkdownLinkUrl(link.rawUrl),
      index: link.index,
    });
  }

  for (const { url, start } of findHttpAutolinks(markdown)) {
    hits.push({ url, index: start });
  }

  for (const { url, start } of findBareHttpUrlHits(markdown)) {
    hits.push({ url, index: start });
  }

  return hits;
}

/**
 * Collect up to 3 unique non-file http(s) URLs from markdown:
 * `[text](url)`, `<autolink>`, and bare URLs in text.
 * Order = first appearance.
 */
export function selectUnfurlCandidateUrls(markdown: string): string[] {
  const hits = collectUrlHits(markdown).toSorted((a, b) => a.index - b.index);
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const { url } of hits) {
    if (!url || seen.has(url) || !isEligibleHttpUrl(url)) {
      continue;
    }
    seen.add(url);
    selected.push(url);
    if (selected.length >= MAX_UNFURL_CANDIDATES) {
      break;
    }
  }

  return selected;
}

export interface UnfurlPreviewContent {
  imageUrl: string | null;
  description: string | null;
}

/** True when an unfurl has a thumbnail or a description (not title-only). */
export function unfurlCardHasPreviewContent(
  card: UnfurlPreviewContent,
): boolean {
  return Boolean(card.imageUrl?.trim()) || Boolean(card.description?.trim());
}
