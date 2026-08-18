import { escapeMarkdownLinkUrl, extractFileLikeLinks } from "@sokosumi/utils";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractTaskAttachmentUrls(markdown: string): string[] {
  return extractFileLikeLinks(markdown);
}

export function sanitizeTaskAttachmentLabel(
  fileName: string,
  fallbackLabel = "file",
): string {
  const sanitized = fileName.replace(/[[\]]/g, "").trim();
  return sanitized || fallbackLabel;
}

export function removeTaskAttachmentLinks(
  markdown: string,
  urlsToRemove: string[],
): string {
  if (urlsToRemove.length === 0) {
    return markdown;
  }

  let next = markdown;
  for (const url of urlsToRemove) {
    const escapedRawUrl = escapeRegExp(url);
    const escapedMarkdownUrl = escapeRegExp(escapeMarkdownLinkUrl(url));
    const markdownLinkPattern = new RegExp(
      `\\[[^\\]]*\\]\\((?:${escapedRawUrl}|${escapedMarkdownUrl})(?:\\s+"[^"]*")?\\)\\n?`,
      "g",
    );
    const autoLinkPattern = new RegExp(`<${escapedRawUrl}>\\n?`, "g");
    next = next.replace(markdownLinkPattern, "");
    next = next.replace(autoLinkPattern, "");
  }

  return next.replace(/\n{3,}/g, "\n\n").trimEnd();
}
