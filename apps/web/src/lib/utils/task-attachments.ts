import {
  escapeMarkdownLinkUrl,
  extractFileLikeLinks,
  replaceMarkdownLinks,
} from "@sokosumi/utils";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractTaskAttachmentUrls(markdown: string): string[] {
  return extractFileLikeLinks(markdown);
}

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

export function sanitizeTaskAttachmentLabel(
  fileName: string,
  fallbackLabel = "file",
): string {
  const sanitized = fileName.replace(/[[\]]/g, "").trim();
  return sanitized || fallbackLabel;
}

export interface TaskDesignMdAttachmentSeed {
  label: string;
  url: string;
}

export interface DesignMdDismissedState {
  linkSeen: boolean;
  dismissed: boolean;
}

export function createDesignMdDismissedState(): DesignMdDismissedState {
  return { linkSeen: false, dismissed: false };
}

export function syncDesignMdDismissedState(
  description: string,
  attachment: TaskDesignMdAttachmentSeed | null | undefined,
  state: DesignMdDismissedState,
): void {
  if (!attachment) {
    return;
  }

  const hasLink = descriptionIncludesTaskAttachmentLink(
    description,
    attachment.label,
    attachment.url,
  );

  if (hasLink) {
    state.linkSeen = true;
    return;
  }

  if (state.linkSeen) {
    state.dismissed = true;
  }
}

export function markDesignMdDismissed(state: DesignMdDismissedState): void {
  state.linkSeen = true;
  state.dismissed = true;
}

export function isDesignMdAttachmentSkipped(
  state: DesignMdDismissedState,
): boolean {
  return state.dismissed;
}

export function seedTaskDescriptionWithDesignMd(
  description: string,
  attachment?: TaskDesignMdAttachmentSeed | null,
): string {
  if (description.trim() || !attachment) {
    return description;
  }

  return ensureDesignMdInDescription(description, attachment);
}

export function ensureDesignMdInDescription(
  description: string,
  attachment?: TaskDesignMdAttachmentSeed | null,
): string {
  if (!attachment) {
    return description;
  }

  if (
    descriptionIncludesTaskAttachmentLink(
      description,
      attachment.label,
      attachment.url,
    )
  ) {
    return description;
  }

  const attachmentMarkdown = formatTaskAttachmentMarkdown(
    attachment.label,
    attachment.url,
  );
  const trimmedDescription = description.trimStart();

  return trimmedDescription
    ? `${attachmentMarkdown}\n${trimmedDescription}`
    : attachmentMarkdown;
}

const DESIGN_MD_ATTACHMENT_LABEL = "DESIGN.md";

export function removeDesignMdAttachmentLinks(markdown: string): string {
  const withoutLinks = replaceMarkdownLinks(markdown, (match) =>
    match.text === DESIGN_MD_ATTACHMENT_LABEL ? "" : match.match,
  );

  return withoutLinks.replace(/\n{3,}/g, "\n\n").trim();
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
