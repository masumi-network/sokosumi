export interface ChatRoomActivitySortKey {
  id: string;
  updatedAt: string | Date;
  starredAt?: string | Date | null;
  mutedAt?: string | Date | null;
  discoverability?: "public" | "private" | "external" | "matched" | null;
}

function isPinned(value: string | Date | null | undefined): boolean {
  return value != null;
}

function starredAtMs(value: string | Date | null | undefined): number {
  if (value == null) {
    return 0;
  }
  return new Date(value).getTime();
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
 * Unmuted before muted; within bucket pinned before unpinned;
 * then public before private in every bucket; among pins oldest
 * starredAt first; then newest activity; stable id tie-break.
 */
export function compareChatRoomsByRecentActivity(
  a: ChatRoomActivitySortKey,
  b: ChatRoomActivitySortKey,
): number {
  const byMuted = mutedRank(a.mutedAt) - mutedRank(b.mutedAt);
  if (byMuted !== 0) {
    return byMuted;
  }

  const aPinned = isPinned(a.starredAt);
  const bPinned = isPinned(b.starredAt);
  if (aPinned !== bPinned) {
    return aPinned ? -1 : 1;
  }

  const byDiscoverability =
    discoverabilityRank(a.discoverability) -
    discoverabilityRank(b.discoverability);
  if (byDiscoverability !== 0) {
    return byDiscoverability;
  }

  if (aPinned) {
    const byPinned = starredAtMs(a.starredAt) - starredAtMs(b.starredAt);
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
