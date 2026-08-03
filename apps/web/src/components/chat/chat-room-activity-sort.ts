export interface ChatRoomActivitySortKey {
  id: string;
  updatedAt: string | Date;
  pinnedAt?: string | Date | null;
}

function pinnedAtMs(value: string | Date | null | undefined): number {
  if (value == null) {
    return 0;
  }
  return new Date(value).getTime();
}

/** Pinned first (pinnedAt desc), then newest activity; stable id tie-break. */
export function compareChatRoomsByRecentActivity(
  a: ChatRoomActivitySortKey,
  b: ChatRoomActivitySortKey,
): number {
  const byPinned = pinnedAtMs(b.pinnedAt) - pinnedAtMs(a.pinnedAt);
  if (byPinned !== 0) {
    return byPinned;
  }

  const byActivity =
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  if (byActivity !== 0) {
    return byActivity;
  }
  return a.id.localeCompare(b.id);
}
