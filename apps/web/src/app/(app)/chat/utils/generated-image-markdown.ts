const DATA_IMAGE_MARKDOWN_START_REGEX =
  /!\[[^\]\n]*\]\(data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,/gi;

const COMPLETE_DATA_IMAGE_MARKDOWN_REGEX =
  /!\[([^\]\n]*)\]\((data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/=\s]+)\)/gi;

const PENDING_DATA_IMAGE_MARKDOWN_REGEX =
  /!\[([^\]\n]*)\]\(data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/=\s]*$/i;

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

/**
 * Markdown image syntax is `![alt](url)`. Alt text cannot contain `]` in our
 * matchers (`[^\]\n]*`), so the URL's closing `)` is the first `)` after
 * `](`, not the first `)` after `![` (alt may contain `)`).
 */
function findMarkdownImageUrlClosingParenIndex(
  fullContent: string,
  imageBangIndex: number,
): number {
  const afterOpenBracket = imageBangIndex + 2;
  if (afterOpenBracket > fullContent.length) {
    return -1;
  }
  const altEnd = fullContent.indexOf("]", afterOpenBracket);
  if (altEnd === -1) {
    return -1;
  }
  if (fullContent.charCodeAt(altEnd + 1) !== 40 /* ( */) {
    return -1;
  }
  return fullContent.indexOf(")", altEnd + 2);
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

    // `exec` yields non-overlapping matches in ascending index order. If the
    // reveal end lies at or before this image's `![`, we're not inside any
    // later image either, so the desired length is already safe.
    if (safeDesiredLength <= start) {
      return safeDesiredLength;
    }

    const closingParenIndex = findMarkdownImageUrlClosingParenIndex(
      fullContent,
      start,
    );

    if (closingParenIndex === -1) {
      return start;
    }

    const end = closingParenIndex + 1;

    if (safeDesiredLength < end) {
      return start;
    }
  }

  return safeDesiredLength;
}

export function advanceRevealPastCompletedDataImages(
  fullContent: string,
  currentLength: number,
): number {
  let safeCurrentLength = Math.max(
    0,
    Math.min(currentLength, fullContent.length),
  );
  let advanced = true;

  while (advanced) {
    advanced = false;
    const regex = new RegExp(DATA_IMAGE_MARKDOWN_START_REGEX);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(fullContent)) !== null) {
      const start = match.index;

      if (safeCurrentLength <= start) {
        return safeCurrentLength;
      }

      const closingParenIndex = findMarkdownImageUrlClosingParenIndex(
        fullContent,
        start,
      );

      if (closingParenIndex === -1) {
        return safeCurrentLength;
      }

      const end = closingParenIndex + 1;

      if (safeCurrentLength < end) {
        safeCurrentLength = end;
        advanced = true;
        break;
      }
    }
  }

  return safeCurrentLength;
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
