/** Elsewhere rows that show before the rest share the overflow row. */
const ELSEWHERE_ROW_LIMIT = 5;

/**
 * Which of Core's ordered Elsewhere rooms get a row of their own (ADR-0061):
 * the first five, every room naming the reader, and the open room. A Pinned room
 * lists under Pinned instead, so it takes no row and no place among the five
 * (ADR-0062). Not `limitSidebarSectionRooms`, which lists a sixth room rather
 * than hide it: the rest here go to Catch up, however few they are.
 */
export function selectElsewhereRows<
  T extends {
    id: string;
    unreadMentionCount: number;
    starredAt: Date | string | null;
  },
>(
  rooms: readonly T[],
  openRoomId: string | null,
): { rows: T[]; overflowCount: number } {
  const unpinned = rooms.filter((room) => room.starredAt == null);
  const rows = unpinned.filter(
    (room, index) =>
      index < ELSEWHERE_ROW_LIMIT ||
      room.unreadMentionCount > 0 ||
      room.id === openRoomId,
  );
  return { rows, overflowCount: unpinned.length - rows.length };
}
