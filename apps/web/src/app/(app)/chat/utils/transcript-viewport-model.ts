import { readClientTurnId } from "@/app/chat/utils/outbound-room-message";
import type { RoomTranscriptRow } from "@/app/chat/utils/room-transcript-ranges";

/**
 * Within this distance of the bottom, content resizes still pin the viewport.
 * Wider than a tiny nudge so mid-stream growth does not drop follow.
 */
export const STICK_TO_BOTTOM_NEAR_PX = 200;

/**
 * Virtuoso needs `firstItemIndex` to stay positive however much history is
 * prepended, so it starts far from zero. It moves down by the rows inserted
 * above the viewport and up by the rows removed there.
 */
export const TRANSCRIPT_FIRST_ITEM_INDEX_START = 1_000_000;

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

/**
 * Rows inserted above the viewport push every index up. Virtuoso keeps the
 * viewport where it was only if `firstItemIndex` moves down by the same
 * count in the same render, so the shift is read off the first row that
 * survived the change: how many rows sit above it now, less how many did
 * before. The first row itself is often what changed (an older page swaps
 * the boundary row for a new one further up), which is why the first row
 * alone cannot be the anchor.
 */
export function firstItemIndexAfterRowsChange({
  previousRows,
  nextRows,
  previousFirstItemIndex,
}: {
  previousRows: readonly RoomTranscriptRow[];
  nextRows: readonly RoomTranscriptRow[];
  previousFirstItemIndex: number;
}): number {
  const nextIndexByKey = new Map<string, number>();
  nextRows.forEach((row, index) => {
    nextIndexByKey.set(transcriptRowKey(row), index);
  });
  for (const [previousIndex, row] of previousRows.entries()) {
    const nextIndex = nextIndexByKey.get(transcriptRowKey(row));
    if (nextIndex !== undefined) {
      return previousFirstItemIndex - (nextIndex - previousIndex);
    }
  }
  return previousFirstItemIndex;
}

/**
 * Whether the view should move to the live edge after the list grew. A
 * reader at the bottom before the growth stays there; one who scrolled up is
 * left alone; a jump that holds the view wins over both. The distance is read
 * net of the growth because the size change can clear the at-bottom state
 * before the height is reported.
 */
export function shouldFollowListGrowth({
  growth,
  held,
  atBottom,
  distanceFromBottom,
}: {
  growth: number;
  held: boolean;
  atBottom: boolean;
  distanceFromBottom: number;
}): boolean {
  if (growth <= 0 || held) {
    return false;
  }
  return atBottom || distanceFromBottom - growth < STICK_TO_BOTTOM_NEAR_PX;
}
