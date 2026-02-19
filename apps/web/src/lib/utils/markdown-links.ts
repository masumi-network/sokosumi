export function createMarkdownLinkRegex(): RegExp {
  return /\[([^\]\n]+)\]\(((?:\\\)|[^)\s])+)(?:\s+"[^"]*")?\)/g;
}

export function unescapeMarkdownLinkUrl(url: string): string {
  return url.replace(/\\\)/g, ")");
}

export function escapeMarkdownLinkUrl(url: string): string {
  return url.replace(/\)/g, "\\)");
}
