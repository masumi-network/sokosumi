import { unfurlCardHasPreviewContent } from "@sokosumi/utils";

import { readClientTurnId } from "@/app/chat/utils/outbound-room-message";
import type { RoomTranscriptRow } from "@/app/chat/utils/room-transcript-ranges";

/**
 * Within this distance of the bottom, content resizes still pin the viewport.
 * Wider than a tiny nudge so mid-stream growth does not drop follow.
 */
export const STICK_TO_BOTTOM_NEAR_PX = 200;

/** Height assumed for a one-line text row until it is measured. */
const DEFAULT_ROW_HEIGHT_PX = 80;

/**
 * Site, title, description, padding, card margin (~7.5rem) at the 1.25×
 * Dynamic Type cap (20px root). Default 16px root is 120px.
 */
const UNFURL_CARD_CHROME_PX = 150;

/**
 * Unfurl image `h-50` (12.5rem) at the 1.25× Dynamic Type cap (20px root).
 * Default 16px root is 200px; overestimate so large type still shrinks.
 */
const UNFURL_IMAGE_HEIGHT_PX = 250;

/** Body `leading-6`. */
const BODY_LINE_HEIGHT_PX = 24;

/** The row clamps a collapsed body to this many lines (`line-clamp-[16]`). */
const BODY_CLAMP_LINES = 16;

/** List `px-5` on both sides, the `size-8` avatar and the `gap-3.5` after it. */
const ROW_INSET_PX = 86;

/** Below this the body is `text-base`, from it `md:text-sm`. */
const BODY_SMALL_TEXT_MIN_WIDTH_PX = 768;

/**
 * Lines the body wraps to, from its length and the width it has. A phone
 * fits a third of the characters a desktop list does, so the same message
 * is several lines taller there; one flat height is wrong by that much.
 */
function estimateBodyLines(content: string, listWidth: number): number {
  if (listWidth <= 0) {
    return 1;
  }
  const fontPx = listWidth < BODY_SMALL_TEXT_MIN_WIDTH_PX ? 16 : 14;
  // Inter averages about half an em a character.
  const charsPerLine = Math.max(
    Math.floor((listWidth - ROW_INSET_PX) / (fontPx / 2)),
    1,
  );
  let lines = 0;
  for (const paragraph of content.split("\n")) {
    lines += Math.max(Math.ceil(paragraph.length / charsPerLine), 1);
  }
  return Math.min(lines, BODY_CLAMP_LINES);
}

/**
 * Size the virtualizer uses for a row that has not mounted yet. History
 * already carries scraped unfurls, so an image card is counted at the
 * image cap plus chrome instead of as another short text row. The error
 * matters most on iOS: the virtualizer cannot correct the scroll position
 * during a touch scroll there, so the reader sees every pixel of it.
 */
export function estimateTranscriptRowHeight(
  row: RoomTranscriptRow | undefined,
  listWidth = 0,
): number {
  if (row === undefined || row.kind !== "message") {
    return DEFAULT_ROW_HEIGHT_PX;
  }
  const cards = row.message.unfurls ?? [];
  let extra = 0;
  for (const card of cards) {
    if (!unfurlCardHasPreviewContent(card)) {
      continue;
    }
    extra += UNFURL_CARD_CHROME_PX;
    if (card.imageUrl?.trim()) {
      extra += UNFURL_IMAGE_HEIGHT_PX;
    }
  }
  const wrappedLines = estimateBodyLines(row.message.content, listWidth) - 1;
  return DEFAULT_ROW_HEIGHT_PX + wrappedLines * BODY_LINE_HEIGHT_PX + extra;
}

/**
 * One key per row for the life of the row. An outbound row keys by its
 * client turn so pending → confirmed keeps one row instance; a boundary row
 * keys by the cursor it loads from.
 */
export function transcriptRowKey(row: RoomTranscriptRow): string {
  if (row.kind === "boundary") {
    return `boundary:${row.cursorMessageId}`;
  }
  return readClientTurnId(row.message) ?? row.message.id;
}

/** Index of the message row with this id, or -1 when the transcript lacks it. */
export function findTranscriptRowIndex(
  rows: readonly RoomTranscriptRow[],
  messageId: string,
): number {
  return rows.findIndex(
    (row) => row.kind === "message" && row.message.id === messageId,
  );
}
