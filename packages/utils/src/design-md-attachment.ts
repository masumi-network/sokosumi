import { replaceMarkdownLinks } from "./markdown-links.js";

export const DESIGN_MD_ATTACHMENT_LABEL = "DESIGN.md";

export function removeDesignMdAttachmentLinks(markdown: string): string {
  const withoutLinks = replaceMarkdownLinks(markdown, (match) =>
    match.text === DESIGN_MD_ATTACHMENT_LABEL ? "" : match.match,
  );

  return withoutLinks.replace(/\n{3,}/g, "\n\n").trim();
}
