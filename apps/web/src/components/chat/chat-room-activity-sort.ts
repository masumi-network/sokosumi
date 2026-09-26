export interface ChatRoomActivitySortKey {
  id: string;
  updatedAt: string | Date;
  mutedAt?: string | Date | null;
  discoverability?: "public" | "private" | "external" | "matched" | null;
}

function mutedRank(value: string | Date | null | undefined): number {
  return value == null ? 0 : 1;
}

/** Public / external / matched / null (directs) before private. */
function discoverabilityRank(
  value: "public" | "private" | "external" | "matched" | null | undefined,
): number {
  return value === "private" ? 1 : 0;
}

/**
 * Unmuted before muted; then public before private; then newest activity;
 * stable id tie-break. Pinned rooms never reach this: the sidebar lists them
 * in their own section, ordered by `comparePinnedChatRooms`.
 */
export function compareChatRoomsByRecentActivity(
  a: ChatRoomActivitySortKey,
  b: ChatRoomActivitySortKey,
): number {
  const byMuted = mutedRank(a.mutedAt) - mutedRank(b.mutedAt);
  if (byMuted !== 0) {
    return byMuted;
  }

  const byDiscoverability =
    discoverabilityRank(a.discoverability) -
    discoverabilityRank(b.discoverability);
  if (byDiscoverability !== 0) {
    return byDiscoverability;
  }

  const byActivity =
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  if (byActivity !== 0) {
    return byActivity;
  }
  return a.id.localeCompare(b.id);
}

export interface PinnedChatRoomSortKey {
  id: string;
  starredAt?: string | Date | null;
}

/**
 * The reader's own order: oldest `starredAt` first, which a reorder rewrites
 * (Core `PUT /chats/rooms/starred`). Activity never moves a pinned room.
 */
export function comparePinnedChatRooms(
  a: PinnedChatRoomSortKey,
  b: PinnedChatRoomSortKey,
): number {
  const byStarred =
    new Date(a.starredAt ?? 0).getTime() - new Date(b.starredAt ?? 0).getTime();
  if (byStarred !== 0) {
    return byStarred;
  }
  return a.id.localeCompare(b.id);
}
