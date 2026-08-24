import { isFileLikeUrl } from "./file-url.js";
import {
  findMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "./markdown-links.js";

export interface ExtractedLink {
  url: string;
  text?: string;
}

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

interface CharRange {
  start: number;
  end: number;
}

interface AutolinkMatch {
  url: string;
  start: number;
  end: number;
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
 * Linear scan for GFM autolinks `<http://…>` / `<https://…>` (no regex — CodeQL ReDoS).
 * Visits each character a constant number of times.
 */
function findAutolinks(markdown: string): AutolinkMatch[] {
  const matches: AutolinkMatch[] = [];
  let i = 0;

  while (i < markdown.length) {
    const open = markdown.indexOf("<", i);
    if (open === -1) {
      break;
    }

    const rest = markdown.slice(open + 1);
    const lowerRest = rest.slice(0, 8).toLowerCase();
    const isHttp =
      lowerRest.startsWith("http://") || lowerRest.startsWith("https://");
    if (!isHttp) {
      i = open + 1;
      continue;
    }

    // Scan until `>`, whitespace, or another `<` (prevents quadratic on "<http://".repeat(n))
    let j = open + 1;
    while (j < markdown.length) {
      const ch = markdown[j];
      if (ch === ">") {
        // Found closing bracket
        const url = markdown.slice(open + 1, j);
        matches.push({
          url,
          start: open,
          end: j + 1,
        });
        i = j + 1;
        break;
      }
      if (
        ch === " " ||
        ch === "\t" ||
        ch === "\n" ||
        ch === "\r" ||
        ch === "<"
      ) {
        // Whitespace or `<` before closing bracket — not a valid autolink
        // Resume at `<` so nested `<http://` can be scanned
        i = ch === "<" ? j : open + 1;
        break;
      }
      j += 1;
    }

    // EOF without closing bracket
    if (j >= markdown.length) {
      i = open + 1;
    }
  }

  return matches;
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
 * Check if a position falls within any of the excluded ranges.
 * Ranges must be sorted by start position (ascending).
 * Uses a cursor to maintain linear complexity O(n + ranges).
 */
function isPositionExcluded(
  position: number,
  excludedRanges: CharRange[],
  cursor: { index: number },
): boolean {
  // Advance cursor to the first range that might contain position
  while (
    cursor.index < excludedRanges.length &&
    excludedRanges[cursor.index]!.end <= position
  ) {
    cursor.index += 1;
  }

  // Check if position is within the current range
  if (cursor.index < excludedRanges.length) {
    const range = excludedRanges[cursor.index]!;
    if (position >= range.start && position < range.end) {
      return true;
    }
  }
  return false;
}

/**
 * Collect character ranges for markdown link destinations and autolinks
 * so bare URL scanner can skip them. Returns ranges sorted by start position.
 */
function collectExcludedRanges(markdown: string): CharRange[] {
  const ranges: CharRange[] = [];

  // Markdown links: exclude the entire [text](url) match
  for (const link of findMarkdownLinks(markdown)) {
    ranges.push({
      start: link.index,
      end: link.index + link.match.length,
    });
  }

  // Autolinks: exclude the entire <url> match
  for (const { start, end } of findAutolinks(markdown)) {
    ranges.push({ start, end });
  }

  // Sort ranges by start position for efficient cursor-based lookup
  ranges.sort((a, b) => a.start - b.start);

  return ranges;
}

/**
 * Linear scan for bare `http://` / `https://` URLs in text (no regex — CodeQL ReDoS).
 * Skips ranges already covered by markdown links and autolinks.
 */
function findBareHttpUrls(text: string, excludedRanges: CharRange[]): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  const cursor = { index: 0 }; // Cursor for excluded ranges

  while (i < text.length) {
    // Skip if current position is inside an excluded range
    if (isPositionExcluded(i, excludedRanges, cursor)) {
      // Jump to end of current excluded range for efficiency
      if (cursor.index < excludedRanges.length) {
        i = excludedRanges[cursor.index]!.end;
      } else {
        i += 1;
      }
      continue;
    }

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

    // Skip if this URL start is inside an excluded range
    if (isPositionExcluded(start, excludedRanges, cursor)) {
      // Jump to end of current excluded range
      if (cursor.index < excludedRanges.length) {
        i = excludedRanges[cursor.index]!.end;
      } else {
        i = start + 1;
      }
      continue;
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
  for (const { url } of findAutolinks(markdown)) {
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

  // Also extract bare URLs from text (skip ranges already covered by markdown/autolinks)
  const excludedRanges = collectExcludedRanges(markdown);
  const bareUrls = findBareHttpUrls(markdown, excludedRanges);
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
