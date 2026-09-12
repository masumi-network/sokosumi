import { readClientTurnId } from "@/app/chat/utils/outbound-room-message";
import type { RoomTranscriptRow } from "@/app/chat/utils/room-transcript-ranges";

/**
 * Virtuoso needs `firstItemIndex` to stay positive however much history is
 * prepended, so it starts far from zero and only ever moves down.
 */
export const TRANSCRIPT_FIRST_ITEM_INDEX_START = 1_000_000;

/**
 * One key per row for the life of the row. An outbound row keys by its
 * client turn so pending → confirmed keeps one row instance; a boundary row
 * keys by the cursor it loads from.
 */
export function transcriptRowKey(
  row: Pick<RoomTranscriptRow, "kind"> &
    (
      | Extract<RoomTranscriptRow, { kind: "message" }>
      | Extract<RoomTranscriptRow, { kind: "boundary" }>
    ),
): string {
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
