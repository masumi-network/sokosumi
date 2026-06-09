export interface MarkdownLinkMatch {
  /** The full matched substring, e.g. `[label](https://example.com)`. */
  match: string;
  /** The link label (text between the brackets). */
  text: string;
  /** The raw, still-escaped url (and is the value passed to unescapeMarkdownLinkUrl). */
  rawUrl: string;
  /** Index of the match within the input. */
  index: number;
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);

/**
 * Scans markdown for inline links of the form `[text](url)` with an optional
 * `"title"` and backslash-escaped characters in the url.
 *
 * This is a single linear left-to-right pass (no backtracking regex) so it is
 * not susceptible to polynomial-time blow-up on adversarial input
 * (js/polynomial-redos). Every character is visited a constant number of times.
 */
export function findMarkdownLinks(input: string): MarkdownLinkMatch[] {
  const matches: MarkdownLinkMatch[] = [];
  const len = input.length;
  let cursor = 0;

  while (cursor < len) {
    const open = input.indexOf("[", cursor);
    if (open === -1) break;

    // Scan the label: characters up to the first `]`, rejecting `[` and newlines.
    let i = open + 1;
    let labelValid = true;
    while (i < len) {
      const c = input[i];
      if (c === "]") break;
      if (c === "[" || c === "\n") {
        labelValid = false;
        break;
      }
      i += 1;
    }

    const labelEnd = i;
    if (
      !labelValid ||
      labelEnd >= len ||
      input[labelEnd] !== "]" ||
      labelEnd === open + 1 || // empty label
      input[labelEnd + 1] !== "("
    ) {
      cursor = open + 1;
      continue;
    }

    const text = input.slice(open + 1, labelEnd);

    // Scan the url: escaped pairs (`\x`) or any char except `[`, `)`, whitespace.
    const urlStart = labelEnd + 2;
    let j = urlStart;
    while (j < len) {
      const c = input[j];
      if (c === "\\") {
        if (j + 1 >= len) break; // dangling backslash at end of input
        j += 2;
        continue;
      }
      if (c === ")" || c === "[" || WHITESPACE.has(c)) break;
      j += 1;
    }

    const rawUrl = input.slice(urlStart, j);
    if (rawUrl.length === 0) {
      cursor = open + 1;
      continue;
    }

    // Optional ` "title"` between the url and the closing paren.
    let close = j;
    if (close < len && WHITESPACE.has(input[close])) {
      let w = close;
      while (w < len && WHITESPACE.has(input[w])) w += 1;
      if (w < len && input[w] === '"') {
        const titleEnd = input.indexOf('"', w + 1);
        if (titleEnd === -1) {
          cursor = open + 1;
          continue;
        }
        close = titleEnd + 1;
      } else {
        cursor = open + 1;
        continue;
      }
    }

    if (close < len && input[close] === ")") {
      const end = close + 1;
      matches.push({
        match: input.slice(open, end),
        text,
        rawUrl,
        index: open,
      });
      cursor = end;
    } else {
      cursor = open + 1;
    }
  }

  return matches;
}

/**
 * Replaces every `[text](url)` link via {@link findMarkdownLinks}, mirroring the
 * relevant subset of `String.prototype.replace` semantics for these links.
 */
export function replaceMarkdownLinks(
  input: string,
  replacer: (match: MarkdownLinkMatch) => string,
): string {
  const matches = findMarkdownLinks(input);
  if (matches.length === 0) return input;

  let result = "";
  let last = 0;
  for (const match of matches) {
    result += input.slice(last, match.index);
    result += replacer(match);
    last = match.index + match.match.length;
  }
  result += input.slice(last);
  return result;
}

export function unescapeMarkdownLinkUrl(url: string): string {
  return url.replace(/\\([\\)])/g, "$1");
}

export function escapeMarkdownLinkUrl(url: string): string {
  // Escape backslashes first so existing backslashes can't combine with the
  // escaped parenthesis to form an unintended escape (js/incomplete-sanitization).
  return url.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
}
