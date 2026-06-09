export function createMarkdownLinkRegex(): RegExp {
  // Excluding `[` from both the text class (`[^[\]\n]`) and the url class
  // (`[^[\\)\s]`) makes every `[` a hard boundary, so nested brackets can't
  // create overlapping match attempts that scan the input super-linearly. The
  // url alternation is unambiguous too: `\\.` consumes an escape as a unit and
  // the class excludes `\`, so no character is matchable two ways. Together
  // this keeps matching linear (js/polynomial-redos).
  return /\[([^[\]\n]+)\]\(((?:\\.|[^[\\)\s])+)(?:\s+"[^"]*")?\)/g;
}

export function unescapeMarkdownLinkUrl(url: string): string {
  return url.replace(/\\([\\)])/g, "$1");
}

export function escapeMarkdownLinkUrl(url: string): string {
  // Escape backslashes first so existing backslashes can't combine with the
  // escaped parenthesis to form an unintended escape (js/incomplete-sanitization).
  return url.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
}
