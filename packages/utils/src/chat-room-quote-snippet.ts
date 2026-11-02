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
  /** Every file link of the message in body order; a file linked twice is one entry. */
  attachments: ChatRoomQuoteAttachment[];
  /**
   * The one attachment a shipped Mac build draws: the first image, else the
   * first file. Goes when those builds read `attachments`.
   */
  attachment: ChatRoomQuoteAttachment | null;
}

/**
 * Plain-text quote body plus the file and image links lifted out of it.
 * Snippet excludes every link captured as an attachment.
 */
export function buildRoomQuoteSnippetParts(
  content: string,
): ChatRoomQuoteSnippetParts {
  const attachmentsByUrl = new Map<string, ChatRoomQuoteAttachment>();
  let contentForSnippet = "";
  let cursor = 0;

  for (const link of findMarkdownLinks(content)) {
    const url = unescapeMarkdownLinkUrl(link.rawUrl);
    if (!isFileLikeUrl(url)) {
      continue;
    }
    contentForSnippet += content.slice(cursor, link.index);
    cursor = link.index + link.match.length;
    if (!attachmentsByUrl.has(url)) {
      attachmentsByUrl.set(url, {
        fileName: link.text,
        url,
        mediaKind: isImageUrl(url) ? "image" : "file",
      });
    }
  }
  contentForSnippet += content.slice(cursor);

  const attachments = [...attachmentsByUrl.values()];
  return {
    snippet: cleanChatMessageText(contentForSnippet),
    attachments,
    attachment:
      attachments.find((attachment) => attachment.mediaKind === "image") ??
      attachments[0] ??
      null,
  };
}

/**
 * A chat message body as plain text: markdown markers gone, a link reduced to
 * its label, horizontal whitespace collapsed, newlines kept.
 *
 * An underscore run flanked by Unicode letters or digits opens no emphasis in
 * CommonMark, so the room prints `COMPOSIO_X_AUTH_CONFIG_ID` and `foo__bar`
 * whole. The run is matched from its first underscore: a `+` that gives one
 * back to the lookahead would delete `foo__bar` from the inside.
 */
export function cleanChatMessageText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\][]+)\]\([^)]+\)/g, "$1")
    .replace(/[*~>#]+/g, "")
    .replace(/(?<![\p{L}\p{N}_])_+(?!_)|(?<!_)_+(?![\p{L}\p{N}_])/gu, "")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}
