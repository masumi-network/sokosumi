import { escapeMarkdownLinkUrl } from "./markdown-links.js";

export function formatTaskAttachmentMarkdown(
  fileName: string,
  url: string,
): string {
  return `[${fileName}](${escapeMarkdownLinkUrl(url)})\n`;
}

export function descriptionIncludesTaskAttachmentLink(
  markdown: string,
  fileName: string,
  url: string,
): boolean {
  return markdown.includes(
    formatTaskAttachmentMarkdown(fileName, url).trimEnd(),
  );
}
