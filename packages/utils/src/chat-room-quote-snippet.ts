import { isFileLikeUrl, isImageUrl } from "./file-url.js";
import {
  findMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "./markdown-links.js";

export interface ChatRoomQuoteAttachment {
  fileName: string;
  url: string;
  mediaKind: "image" | "file";
}

export interface ChatRoomQuoteSnippetParts {
  snippet: string;
  attachment: ChatRoomQuoteAttachment | null;
}

/**
 * Plain-text quote body plus optional first file/image cue from markdown links.
 * Prefers the first image-like file link, else the first file-like link.
 * Snippet excludes the link captured as attachment.
 */
export function buildRoomQuoteSnippetParts(
  content: string,
): ChatRoomQuoteSnippetParts {
  const attachmentMatch = findQuoteAttachmentMatch(content);
  const contentForSnippet = attachmentMatch
    ? `${content.slice(0, attachmentMatch.index)}${content.slice(attachmentMatch.index + attachmentMatch.match.length)}`
    : content;

  return {
    snippet: cleanQuoteSnippet(contentForSnippet),
    attachment: attachmentMatch?.attachment ?? null,
  };
}

/**
 * Plain-text quote body for a quoted room message. Strips cheap markdown
 * markers and collapses horizontal whitespace while preserving newlines.
 * Mention tokens stay intact; the render layer formats them for display.
 * Returns the full cleaned message (no character truncation).
 * File/image links promoted to quote attachment are excluded from the text.
 */
export function buildQuoteSnippet(content: string): string {
  return buildRoomQuoteSnippetParts(content).snippet;
}

function findQuoteAttachmentMatch(content: string): {
  attachment: ChatRoomQuoteAttachment;
  match: string;
  index: number;
} | null {
  const fileLinks = findMarkdownLinks(content)
    .map((link) => ({
      match: link.match,
      index: link.index,
      fileName: link.text,
      url: unescapeMarkdownLinkUrl(link.rawUrl),
    }))
    .filter((link) => isFileLikeUrl(link.url));

  const chosen =
    fileLinks.find((link) => isImageUrl(link.url)) ?? fileLinks[0] ?? null;
  if (!chosen) {
    return null;
  }

  return {
    match: chosen.match,
    index: chosen.index,
    attachment: {
      fileName: chosen.fileName,
      url: chosen.url,
      mediaKind: isImageUrl(chosen.url) ? "image" : "file",
    },
  };
}

function cleanQuoteSnippet(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#]+/g, "")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}
