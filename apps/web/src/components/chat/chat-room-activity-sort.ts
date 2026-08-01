export interface ChatRoomActivitySortKey {
  id: string;
  updatedAt: string | Date;
}

/** Newest activity first; stable id tie-break. Shared by channels and DMs. */
export function compareChatRoomsByRecentActivity(
  a: ChatRoomActivitySortKey,
  b: ChatRoomActivitySortKey,
): number {
  const byActivity =
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  if (byActivity !== 0) {
    return byActivity;
  }
  return a.id.localeCompare(b.id);
}
