import { isFileLikeUrl } from "./file-url.js";
import {
  findMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "./markdown-links.js";
import {
  collectMarkdownUrlExcludedRanges,
  findBareHttpUrlHits,
  findHttpAutolinks,
} from "./markdown-url-scan.js";

const MAX_UNFURL_CANDIDATES = 3;

interface UrlHit {
  url: string;
  index: number;
}

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
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

  // A link's own destination is not text: scanning it again as a bare URL
  // would trim its punctuation and add a second, different URL.
  for (const { url, start } of findBareHttpUrlHits(
    markdown,
    collectMarkdownUrlExcludedRanges(markdown),
  )) {
    hits.push({ url, index: start });
  }

  return hits;
}

/**
 * Every unique http(s) URL in markdown, file links included:
 * `[text](url)`, `<autolink>`, and bare URLs in text.
 * Order = first appearance.
 */
export function listHttpUrls(markdown: string): string[] {
  const hits = collectUrlHits(markdown).toSorted((a, b) => a.index - b.index);
  const urls = new Set<string>();
  for (const { url } of hits) {
    if (url && isHttpUrl(url)) urls.add(url);
  }
  return [...urls];
}

/**
 * Collect up to 3 unique non-file http(s) URLs from markdown:
 * `[text](url)`, `<autolink>`, and bare URLs in text.
 * Order = first appearance.
 */
export function selectUnfurlCandidateUrls(markdown: string): string[] {
  return listHttpUrls(markdown)
    .filter((url) => !isFileLikeUrl(url))
    .slice(0, MAX_UNFURL_CANDIDATES);
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
