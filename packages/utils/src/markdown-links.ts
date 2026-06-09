export function createMarkdownLinkRegex(): RegExp {
  // `\\.` consumes an escape sequence as a unit; `[^\\)\s]` excludes the
  // backslash so a character can never be matched two ways. This removes the
  // ambiguity that caused polynomial backtracking (js/polynomial-redos).
  return /\[([^\]\n]+)\]\(((?:\\.|[^\\)\s])+)(?:\s+"[^"]*")?\)/g;
}

export function unescapeMarkdownLinkUrl(url: string): string {
  return url.replace(/\\([\\)])/g, "$1");
}

export function escapeMarkdownLinkUrl(url: string): string {
  // Escape backslashes first so existing backslashes can't combine with the
  // escaped parenthesis to form an unintended escape (js/incomplete-sanitization).
  return url.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
}
