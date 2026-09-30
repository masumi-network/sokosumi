import {
  findMarkdownLinks,
  isFileLikeUrl,
  unescapeMarkdownLinkUrl,
} from "@sokosumi/utils";

export interface RoomMessageFileLink {
  url: string;
  fileName: string;
  index: number;
  matchLength: number;
}

export interface RoomMessageTextSegment {
  kind: "text";
  content: string;
  start: number;
}

export interface RoomMessageFilesSegment {
  kind: "files";
  links: [RoomMessageFileLink, ...RoomMessageFileLink[]];
}

export type RoomMessageSegment =
  | RoomMessageTextSegment
  | RoomMessageFilesSegment;

function isAttachmentRunGap(gap: string): boolean {
  return /^\s*$/.test(gap);
}

/**
 * A file link becomes a card only on a line of its own (or a line of file
 * links): in a sentence it stays a link, or "It's in your Files as [x](…)."
 * renders a tile mid-sentence.
 */
function standaloneLinks(
  content: string,
  links: RoomMessageFileLink[],
): RoomMessageFileLink[] {
  return links.filter((link) => {
    const start = content.lastIndexOf("\n", link.index - 1) + 1;
    const newline = content.indexOf("\n", link.index + link.matchLength);
    const end = newline === -1 ? content.length : newline;
    let rest = "";
    let cursor = start;
    for (const other of links) {
      if (other.index < start || other.index >= end) continue;
      rest += content.slice(cursor, other.index);
      cursor = other.index + other.matchLength;
    }
    rest += content.slice(cursor, end);
    return isAttachmentRunGap(rest);
  });
}

export function segmentRoomMessageContent(
  content: string,
): RoomMessageSegment[] {
  const candidates: RoomMessageFileLink[] = [];
  for (const match of findMarkdownLinks(content)) {
    const url = unescapeMarkdownLinkUrl(match.rawUrl);
    if (!isFileLikeUrl(url)) {
      continue;
    }
    candidates.push({
      url,
      fileName: match.text,
      index: match.index,
      matchLength: match.match.length,
    });
  }
  const fileLinks = standaloneLinks(content, candidates);

  if (fileLinks.length === 0) {
    return [{ kind: "text", content, start: 0 }];
  }

  const segments: RoomMessageSegment[] = [];
  let cursor = 0;
  let openFiles: RoomMessageFileLink[] | null = null;

  function flushFiles(): void {
    if (openFiles === null || openFiles.length === 0) {
      return;
    }
    const [head, ...rest] = openFiles;
    segments.push({ kind: "files", links: [head, ...rest] });
    openFiles = null;
  }

  for (const link of fileLinks) {
    const gap = content.slice(cursor, link.index);

    if (openFiles === null) {
      if (gap.length > 0 && !isAttachmentRunGap(gap)) {
        segments.push({ kind: "text", content: gap, start: cursor });
      }
      openFiles = [link];
    } else if (isAttachmentRunGap(gap)) {
      openFiles.push(link);
    } else {
      flushFiles();
      if (gap.length > 0) {
        segments.push({ kind: "text", content: gap, start: cursor });
      }
      openFiles = [link];
    }

    cursor = link.index + link.matchLength;
  }

  flushFiles();

  if (cursor < content.length) {
    const trailing = content.slice(cursor);
    if (trailing.length > 0 && !isAttachmentRunGap(trailing)) {
      segments.push({ kind: "text", content: trailing, start: cursor });
    }
  }

  return segments;
}
