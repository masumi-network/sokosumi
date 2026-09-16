import { unfurlCardHasPreviewContent } from "@sokosumi/utils";

import { readClientTurnId } from "@/app/chat/utils/outbound-room-message";
import type { RoomTranscriptRow } from "@/app/chat/utils/room-transcript-ranges";

/**
 * Within this distance of the bottom, content resizes still pin the viewport.
 * Wider than a tiny nudge so mid-stream growth does not drop follow.
 */
export const STICK_TO_BOTTOM_NEAR_PX = 200;

/** Height assumed for a short text row until it is measured. */
const DEFAULT_ROW_HEIGHT_PX = 80;

/**
 * Site, title, description, padding, card margin. Overestimate so a
 * history row shrinks, not grows.
 */
const UNFURL_CARD_CHROME_PX = 120;

/**
 * Unfurl image `h-50` (12.5rem) at the 1.25× Dynamic Type cap (20px root).
 * Default 16px root is 200px; overestimate so large type still shrinks.
 */
const UNFURL_IMAGE_HEIGHT_PX = 250;

/**
 * Size the virtualizer uses for a row that has not mounted yet. History
 * already carries scraped unfurls, so an image card is counted at the
 * image cap plus chrome instead of as another short text row.
 */
export function estimateTranscriptRowHeight(
  row: RoomTranscriptRow | undefined,
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
  return DEFAULT_ROW_HEIGHT_PX + extra;
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
