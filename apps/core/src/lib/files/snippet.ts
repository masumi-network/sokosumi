import { normalizeFileResourceName } from "@sokosumi/utils";

/**
 * Snippets are extracted, never generated.
 *
 * The API returns plain text plus character offsets rather than markup, so
 * the client escapes once at render and there is no HTML string anywhere for
 * document content to ride in on.
 */

export const SNIPPET_MAX_CHARS = 240;

export interface SnippetHighlight {
  start: number;
  end: number;
}

export interface FileSnippet {
  text: string;
  highlights: SnippetHighlight[];
  /** True when the snippet starts or ends mid-document. */
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

function queryTerms(query: string): string[] {
  return normalizeFileResourceName(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 2)
    .slice(0, 8);
}

/**
 * Find every occurrence of any query term, in the normalized-case text, and
 * map it back onto the original so the returned offsets index the text we
 * actually return.
 */
function findMatches(text: string, terms: string[]): SnippetHighlight[] {
  const haystack = text.toLocaleLowerCase("en-US");
  const matches: SnippetHighlight[] = [];

  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(term, from);
      if (at === -1) break;
      matches.push({ start: at, end: at + term.length });
      from = at + term.length;
      if (matches.length > 64) break;
    }
  }

  matches.sort((left, right) => left.start - right.start);

  // Merge overlaps so two terms that touch do not produce nested spans.
  const merged: SnippetHighlight[] = [];
  for (const match of matches) {
    const last = merged[merged.length - 1];
    if (last && match.start <= last.end) {
      last.end = Math.max(last.end, match.end);
    } else {
      merged.push({ ...match });
    }
  }
  return merged;
}

/**
 * Build a bounded window around the first match. With no query, or no match
 * in the passage, the leading window is returned so the reader still sees
 * where the document starts rather than nothing at all.
 */
export function buildFileSnippet(input: {
  text: string;
  query: string | null;
  maxChars?: number;
}): FileSnippet {
  const maxChars = input.maxChars ?? SNIPPET_MAX_CHARS;
  const source = input.text.replace(/\s+/gu, " ").trim();

  if (source.length === 0) {
    return {
      text: "",
      highlights: [],
      truncatedStart: false,
      truncatedEnd: false,
    };
  }

  const terms = input.query ? queryTerms(input.query) : [];
  const matches = terms.length > 0 ? findMatches(source, terms) : [];

  if (source.length <= maxChars) {
    return {
      text: source,
      highlights: matches.filter((match) => match.end <= source.length),
      truncatedStart: false,
      truncatedEnd: false,
    };
  }

  const anchor = matches[0]?.start ?? 0;
  // Keep a little context before the match so the sentence reads.
  const lead = Math.min(48, Math.floor(maxChars / 4));
  let start = Math.max(0, anchor - lead);
  let end = Math.min(source.length, start + maxChars);
  if (end - start < maxChars) start = Math.max(0, end - maxChars);

  // Prefer a word boundary so a snippet does not begin mid-word.
  if (start > 0) {
    const space = source.indexOf(" ", start);
    if (space !== -1 && space - start < 24) start = space + 1;
  }
  if (end < source.length) {
    const space = source.lastIndexOf(" ", end);
    if (space !== -1 && end - space < 24 && space > start) end = space;
  }

  const window = source.slice(start, end);

  const highlights = matches
    .filter((match) => match.start >= start && match.end <= end)
    .map((match) => ({ start: match.start - start, end: match.end - start }));

  return {
    text: window,
    highlights,
    truncatedStart: start > 0,
    truncatedEnd: end < source.length,
  };
}
