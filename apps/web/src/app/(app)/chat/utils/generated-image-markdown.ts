const DATA_IMAGE_MARKDOWN_START_REGEX =
  /!\[[^\]\n]*\]\(data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,/g;

const COMPLETE_DATA_IMAGE_MARKDOWN_REGEX =
  /!\[([^\]\n]*)\]\((data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/=\s]+)\)/g;

const PENDING_DATA_IMAGE_MARKDOWN_REGEX =
  /!\[([^\]\n]*)\]\(data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/=\s]*$/;

export interface GeneratedImageTextSegment {
  type: "text";
  text: string;
}

export interface GeneratedImageSegment {
  type: "image";
  alt: string;
  src: string;
}

export interface PendingGeneratedImageSegment {
  type: "pending-image";
  alt: string;
}

export type GeneratedImageMarkdownSegment =
  | GeneratedImageTextSegment
  | GeneratedImageSegment
  | PendingGeneratedImageSegment;

function normalizeDataImageSrc(src: string): string {
  return src.replace(/\s/g, "");
}

function findPendingDataImageTail(content: string) {
  const match = PENDING_DATA_IMAGE_MARKDOWN_REGEX.exec(content);

  if (!match || match.index === undefined) {
    return null;
  }

  return {
    start: match.index,
    alt: match[1] ?? "",
  };
}

export function clampRevealLengthForMarkdownDataImages(
  fullContent: string,
  desiredLength: number,
): number {
  const safeDesiredLength = Math.max(
    0,
    Math.min(desiredLength, fullContent.length),
  );
  const regex = new RegExp(DATA_IMAGE_MARKDOWN_START_REGEX);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(fullContent)) !== null) {
    const start = match.index;

    if (safeDesiredLength <= start) {
      continue;
    }

    const closingParenIndex = fullContent.indexOf(")", start);

    if (closingParenIndex === -1) {
      return start;
    }

    const end = closingParenIndex + 1;

    if (safeDesiredLength < end) {
      return end;
    }
  }

  return safeDesiredLength;
}

export function parseMarkdownWithDataImageSegments(
  content: string,
): GeneratedImageMarkdownSegment[] {
  const segments: GeneratedImageMarkdownSegment[] = [];
  const pendingTail = findPendingDataImageTail(content);
  const parseableContent = pendingTail
    ? content.slice(0, pendingTail.start)
    : content;
  const regex = new RegExp(COMPLETE_DATA_IMAGE_MARKDOWN_REGEX);
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(parseableContent)) !== null) {
    if (match.index > cursor) {
      segments.push({
        type: "text",
        text: parseableContent.slice(cursor, match.index),
      });
    }

    segments.push({
      type: "image",
      alt: match[1] ?? "",
      src: normalizeDataImageSrc(match[2] ?? ""),
    });

    cursor = match.index + match[0].length;
  }

  if (cursor < parseableContent.length) {
    segments.push({
      type: "text",
      text: parseableContent.slice(cursor),
    });
  }

  if (pendingTail) {
    segments.push({
      type: "pending-image",
      alt: pendingTail.alt,
    });
  }

  return segments;
}
