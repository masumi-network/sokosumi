import { readClientTurnId } from "@/app/chat/utils/outbound-room-message";
import type { RoomTranscriptRow } from "@/app/chat/utils/room-transcript-ranges";

/**
 * Within this distance of the bottom, content resizes still pin the viewport.
 * Wider than a tiny nudge so mid-stream growth does not drop follow.
 */
export const STICK_TO_BOTTOM_NEAR_PX = 200;

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
