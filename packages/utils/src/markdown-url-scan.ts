import { findMarkdownLinks } from "./markdown-links.js";

export interface MarkdownUrlScanHit {
  url: string;
  start: number;
  end: number;
}

export interface CharRange {
  start: number;
  end: number;
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
 * Linear scan for GFM autolinks `<http://…>` / `<https://…>` (no regex — CodeQL ReDoS).
 * Case-insensitive scheme matching. Visits each character a constant number of times.
 */
export function findHttpAutolinks(markdown: string): MarkdownUrlScanHit[] {
  const matches: MarkdownUrlScanHit[] = [];
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

    if (j >= markdown.length) {
      i = open + 1;
    }
  }

  return matches;
}

/**
 * Check if a position falls within any of the excluded ranges.
 * Ranges must be sorted by start position (ascending).
 * Uses a cursor to maintain linear complexity O(n + ranges).
 */
function isPositionExcluded(
  position: number,
  excludedRanges: readonly CharRange[],
  cursor: { index: number },
): boolean {
  while (
    cursor.index < excludedRanges.length &&
    excludedRanges[cursor.index]!.end <= position
  ) {
    cursor.index += 1;
  }

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
 * so the bare URL scanner can skip them. Returns ranges sorted by start.
 */
export function collectMarkdownUrlExcludedRanges(
  markdown: string,
): CharRange[] {
  const ranges: CharRange[] = [];

  for (const link of findMarkdownLinks(markdown)) {
    ranges.push({
      start: link.index,
      end: link.index + link.match.length,
    });
  }

  for (const { start, end } of findHttpAutolinks(markdown)) {
    ranges.push({ start, end });
  }

  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

/**
 * Linear scan for bare `http://` / `https://` URLs in text (no regex — CodeQL ReDoS).
 * Case-insensitive scheme matching. Skips `excludedRanges` when provided.
 */
export function findBareHttpUrlHits(
  markdown: string,
  excludedRanges: readonly CharRange[] = [],
): MarkdownUrlScanHit[] {
  const results: MarkdownUrlScanHit[] = [];
  let i = 0;
  const cursor = { index: 0 };
  const lowerText = markdown.toLowerCase();

  while (i < markdown.length) {
    if (isPositionExcluded(i, excludedRanges, cursor)) {
      if (cursor.index < excludedRanges.length) {
        i = excludedRanges[cursor.index]!.end;
      } else {
        i += 1;
      }
      continue;
    }

    const httpsIndex = lowerText.indexOf("https://", i);
    const httpIndex = lowerText.indexOf("http://", i);
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

    if (isPositionExcluded(start, excludedRanges, cursor)) {
      if (cursor.index < excludedRanges.length) {
        i = excludedRanges[cursor.index]!.end;
      } else {
        i = start + 1;
      }
      continue;
    }

    let end = start;
    while (end < markdown.length && !isBareUrlStopChar(markdown[end]!)) {
      end += 1;
    }
    const raw = markdown.slice(start, end);
    const url = normalizeBareUrl(raw);
    if (url.length > 0) {
      results.push({ url, start, end });
    }
    i = Math.max(end, start + 1);
  }
  return results;
}
