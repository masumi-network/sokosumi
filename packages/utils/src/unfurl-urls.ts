import { isFileLikeUrl } from "./file-url.js";
import {
  findMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "./markdown-links.js";

const MAX_UNFURL_CANDIDATES = 3;

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

function isBareUrlStopChar(ch: string): boolean {
  return (
    ch === " " ||
    ch === "\t" ||
    ch === "\n" ||
    ch === "\r" ||
    ch === "<" ||
    ch === ">" ||
    ch === "[" ||
    ch === "]" ||
    ch === "`" ||
    ch === "'" ||
    ch === '"'
  );
}

/**
 * Linear scan for bare `http://` / `https://` URLs (no regex — CodeQL ReDoS).
 */
function findBareHttpUrlHits(text: string): UrlHit[] {
  const hits: UrlHit[] = [];
  let i = 0;
  while (i < text.length) {
    const httpsIndex = text.indexOf("https://", i);
    const httpIndex = text.indexOf("http://", i);
    let start = -1;
    if (httpsIndex === -1) {
      start = httpIndex;
    } else if (httpIndex === -1) {
      start = httpsIndex;
    } else {
      start = Math.min(httpsIndex, httpIndex);
    }
    if (start === -1) {
      break;
    }

    let end = start;
    while (end < text.length && !isBareUrlStopChar(text[end]!)) {
      end += 1;
    }
    const raw = text.slice(start, end);
    const url = normalizeBareUrl(raw);
    if (url.length > 0) {
      hits.push({ url, index: start });
    }
    i = Math.max(end, start + 1);
  }
  return hits;
}

/**
 * Linear scan for GFM autolinks `<http://…>` / `<https://…>` (no regex).
 */
function findAngleAutolinkHits(markdown: string): UrlHit[] {
  const hits: UrlHit[] = [];
  let i = 0;
  while (i < markdown.length) {
    const open = markdown.indexOf("<", i);
    if (open === -1) {
      break;
    }
    const rest = markdown.slice(open + 1);
    const isHttp = rest.startsWith("http://") || rest.startsWith("https://");
    if (!isHttp) {
      i = open + 1;
      continue;
    }

    const close = markdown.indexOf(">", open + 1);
    if (close === -1) {
      break;
    }
    const url = markdown.slice(open + 1, close);
    if (!url.includes(" ") && !url.includes("\t") && !url.includes("\n")) {
      hits.push({ url, index: open });
    }
    i = close + 1;
  }
  return hits;
}

/**
 * Finds bare http(s) URLs in text (prose), stripped of trailing punctuation.
 * Does not exclude file-like URLs — callers filter via {@link selectUnfurlCandidateUrls}.
 */
export function extractBareHttpUrls(text: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const { url } of findBareHttpUrlHits(text)) {
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

  hits.push(...findAngleAutolinkHits(markdown));
  hits.push(...findBareHttpUrlHits(markdown));

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
