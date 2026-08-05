import { isFileLikeUrl } from "./file-url.js";
import {
  findMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "./markdown-links.js";

const MAX_UNFURL_CANDIDATES = 3;

/**
 * GFM-style autolinks `<https://…>` / `<http://…>`.
 * Kept linear-time: no nested quantifiers / ambiguous alternation (CodeQL).
 */
const AUTO_LINKS = /<https?:\/\/[^>\s]+>/gi;

/** Bare http(s) URLs in prose (not inside angle brackets). */
const BARE_HTTP_URL = /https?:\/\/[^\s<>\[\]`'"]+/gi;

const TRAILING_PUNCTUATION_CHARS = new Set([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  ")",
  "}",
  "]",
]);

interface UrlHit {
  url: string;
  index: number;
}

/** Strip trailing punctuation glued onto bare URLs in chat prose (no regex). */
function normalizeBareUrl(raw: string): string {
  let end = raw.length;
  while (end > 0 && TRAILING_PUNCTUATION_CHARS.has(raw[end - 1]!)) {
    end -= 1;
  }
  return end === raw.length ? raw : raw.slice(0, end);
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

/**
 * Finds bare http(s) URLs in text (prose), stripped of trailing punctuation.
 * Does not exclude file-like URLs — callers filter via {@link selectUnfurlCandidateUrls}.
 */
export function extractBareHttpUrls(text: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(BARE_HTTP_URL)) {
    const url = normalizeBareUrl(match[0]!);
    if (!url || seen.has(url)) {
      continue;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
    } catch {
      continue;
    }
    seen.add(url);
    results.push(url);
  }
  return results;
}

function collectUrlHits(markdown: string): UrlHit[] {
  const hits: UrlHit[] = [];

  for (const link of findMarkdownLinks(markdown)) {
    hits.push({
      url: unescapeMarkdownLinkUrl(link.rawUrl),
      index: link.index,
    });
  }

  for (const match of markdown.matchAll(AUTO_LINKS)) {
    if (match.index === undefined) {
      continue;
    }
    // Full match is `<url>`; strip the wrapping angle brackets.
    const wrapped = match[0]!;
    hits.push({
      url: wrapped.slice(1, -1),
      index: match.index,
    });
  }

  for (const match of markdown.matchAll(BARE_HTTP_URL)) {
    if (match.index === undefined) {
      continue;
    }
    hits.push({
      url: normalizeBareUrl(match[0]!),
      index: match.index,
    });
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
