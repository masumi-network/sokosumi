import { isFileLikeUrl } from "./file-url.js";
import {
  findMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "./markdown-links.js";

export interface ExtractedLink {
  url: string;
  text?: string;
}

const AUTO_LINKS = /<((?:https?:)\/\/[^>\s]+)>/gi;

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

/** Strip trailing punctuation glued onto bare URLs in text (no regex). */
function normalizeBareUrl(raw: string): string {
  let end = raw.length;
  while (end > 0 && TRAILING_PUNCTUATION_CHARS.has(raw[end - 1]!)) {
    end -= 1;
  }
  return end === raw.length ? raw : raw.slice(0, end);
}

/**
 * Linear scan for bare `http://` / `https://` URLs in text (no regex — CodeQL ReDoS).
 */
function findBareHttpUrls(text: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
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
    if (url.length > 0 && !seen.has(url)) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          seen.add(url);
          results.push(url);
        }
      } catch {
        // ignore malformed URLs
      }
    }
    i = Math.max(end, start + 1);
  }
  return results;
}

/**
 * Extracts markdown-style links [text](url) and autolinks <http://...> from markdown.
 */
export function extractLinks(markdown: string): ExtractedLink[] {
  const results: ExtractedLink[] = [];

  for (const { text, rawUrl } of findMarkdownLinks(markdown)) {
    results.push({ url: unescapeMarkdownLinkUrl(rawUrl), text });
  }
  for (const match of markdown.matchAll(AUTO_LINKS)) {
    const [, url] = match;
    results.push({ url });
  }

  return results;
}

export function extractFileLikeLinks(markdown: string): string[] {
  const fileLinks = new Set<string>();

  // Extract from markdown links [text](url) and autolinks <http://...>
  const links = extractLinks(markdown);
  for (const l of links) {
    if (isFileLikeUrl(l.url)) {
      fileLinks.add(l.url);
    }
  }

  // Also extract bare URLs from text
  const bareUrls = findBareHttpUrls(markdown);
  for (const url of bareUrls) {
    if (isFileLikeUrl(url)) {
      fileLinks.add(url);
    }
  }

  return Array.from(fileLinks);
}

export function extractHttpLinks(markdown: string): string[] {
  const links = extractLinks(markdown);
  const http = new Set<string>();
  for (const l of links) {
    try {
      const u = new URL(l.url);
      if (
        (u.protocol === "http:" || u.protocol === "https:") &&
        !isFileLikeUrl(l.url)
      ) {
        http.add(l.url);
      }
    } catch {
      // ignore malformed URLs
    }
  }
  return Array.from(http);
}
