import {
  DESIGN_MD_ATTACHMENT_LABEL,
  escapeMarkdownLinkUrl,
  extractFileLikeLinks,
  PROJECT_BRIEFING_ATTACHMENT_LABEL,
  PROJECT_CONTEXT_MD_ATTACHMENT_LABEL,
} from "@sokosumi/utils";

/** Context-owned labels shown in the Context chip row, not as generic file chips. */
const TASK_CONTEXT_CHIP_EXCLUDED_LABELS: ReadonlySet<string> = new Set([
  DESIGN_MD_ATTACHMENT_LABEL,
  PROJECT_BRIEFING_ATTACHMENT_LABEL,
  PROJECT_CONTEXT_MD_ATTACHMENT_LABEL,
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractTaskAttachmentUrls(markdown: string): string[] {
  return extractFileLikeLinks(markdown, {
    excludeLinkLabels: TASK_CONTEXT_CHIP_EXCLUDED_LABELS,
  });
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
