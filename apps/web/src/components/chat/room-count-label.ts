/**
 * Shared cap for the numeric counts chat chrome renders beside a room.
 *
 * Sidebar rows and the room-header threads trigger both show a reader-facing
 * number, and a very loud room must not reflow either one. One cap keeps the
 * two surfaces saying the same thing about the same room.
 */
export const ROOM_COUNT_CAP = 99;

/** Display form of a chat count, capped at `ROOM_COUNT_CAP`. */
export function roomCountLabel(count: number): string {
  return count > ROOM_COUNT_CAP ? `${ROOM_COUNT_CAP}+` : String(count);
}
