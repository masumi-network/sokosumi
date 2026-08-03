export interface ChatRoomActivitySortKey {
  id: string;
  updatedAt: string | Date;
  pinnedAt?: string | Date | null;
  mutedAt?: string | Date | null;
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

<<<<<<< HEAD
/**
 * Pinned before unpinned; among pins oldest pinnedAt first (first pin stays top);
 * then newest activity; stable id tie-break.
 */
=======
function mutedRank(value: string | Date | null | undefined): number {
  return value == null ? 0 : 1;
}

/** Unmuted first; within bucket pinned first (pinnedAt desc), then activity, then id. */
>>>>>>> 7e4a24a4 (feat(web): mute chat rooms in sidebar)
export function compareChatRoomsByRecentActivity(
  a: ChatRoomActivitySortKey,
  b: ChatRoomActivitySortKey,
): number {
<<<<<<< HEAD
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
=======
  const byMuted = mutedRank(a.mutedAt) - mutedRank(b.mutedAt);
  if (byMuted !== 0) {
    return byMuted;
  }

  const byPinned = pinnedAtMs(b.pinnedAt) - pinnedAtMs(a.pinnedAt);
  if (byPinned !== 0) {
    return byPinned;
>>>>>>> 7e4a24a4 (feat(web): mute chat rooms in sidebar)
  }

  const byActivity =
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  if (byActivity !== 0) {
    return byActivity;
  }
  return a.id.localeCompare(b.id);
}
