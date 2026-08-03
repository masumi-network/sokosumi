export interface ChatRoomActivitySortKey {
  id: string;
  updatedAt: string | Date;
  pinnedAt?: string | Date | null;
}

function isPinned(value: string | Date | null | undefined): boolean {
  return value != null;
}

function pinnedAtMs(value: string | Date | null | undefined): number {
  if (value == null) {
    return 0;
  }
  return new Date(value).getTime();
}

/**
 * Pinned before unpinned; among pins oldest pinnedAt first (first pin stays top);
 * then newest activity; stable id tie-break.
 */
export function compareChatRoomsByRecentActivity(
  a: ChatRoomActivitySortKey,
  b: ChatRoomActivitySortKey,
): number {
  const aPinned = isPinned(a.pinnedAt);
  const bPinned = isPinned(b.pinnedAt);
  if (aPinned !== bPinned) {
    return aPinned ? -1 : 1;
  }

  if (aPinned) {
    const byPinned = pinnedAtMs(a.pinnedAt) - pinnedAtMs(b.pinnedAt);
    if (byPinned !== 0) {
      return byPinned;
    }
  }

  const byActivity =
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  if (byActivity !== 0) {
    return byActivity;
  }
  return a.id.localeCompare(b.id);
}
