/** Session attention snapshots protect remounts from stale server props. */
interface RoomReadOverlay {
  updatedAtMs: number;
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread: boolean;
  revision: number;
  pending: {
    token: number;
    expiresAt: number;
    rollbackAttention: RoomAttentionFields;
  } | null;
}

interface RoomAttentionFields {
  id: string;
  updatedAt: string | Date;
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread: boolean;
}

const overlaysByRoomId = new Map<string, RoomReadOverlay>();
// A stalled mutation must not suppress authoritative sidebar polls indefinitely.
const PENDING_ATTENTION_TIMEOUT_MS = 30_000;
let revision = 0;

function toUpdatedAtMs(updatedAt: string | Date): number {
  const ms = new Date(updatedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function storeAttention(
  room: RoomAttentionFields,
  nextRevision: number,
  pending: RoomReadOverlay["pending"] = null,
): void {
  overlaysByRoomId.set(room.id, {
    updatedAtMs: toUpdatedAtMs(room.updatedAt),
    unreadCount: room.unreadCount,
    unreadMentionCount: room.unreadMentionCount,
    markedUnread: room.markedUnread,
    revision: nextRevision,
    pending,
  });
}

function getRoomReadOverlay(roomId: string): RoomReadOverlay | undefined {
  const overlay = overlaysByRoomId.get(roomId);
  if (overlay?.pending && Date.now() >= overlay.pending.expiresAt) {
    // Keep the original revision so a fresh poll can replace the rollback.
    // Removing the pending token also prevents late responses from settling it.
    storeAttention(overlay.pending.rollbackAttention, overlay.revision);
    return overlaysByRoomId.get(roomId);
  }
  return overlay;
}

function applyAttention<T extends RoomAttentionFields>(
  room: T,
  overlay: RoomReadOverlay,
): T {
  return {
    ...room,
    unreadCount: overlay.unreadCount,
    unreadMentionCount: overlay.unreadMentionCount,
    markedUnread: overlay.markedUnread,
  };
}

/** Event listeners may repeat an optimistic snapshot without settling it. */
export function rememberRoomRead(room: RoomAttentionFields): void {
  const overlay = getRoomReadOverlay(room.id);
  storeAttention(
    {
      ...room,
      // Event listeners can repeat attention using older room props.
      updatedAt: new Date(
        Math.max(toUpdatedAtMs(room.updatedAt), overlay?.updatedAtMs ?? 0),
      ),
    },
    ++revision,
    overlay?.pending ?? null,
  );
}

export function beginRoomAttentionChange(
  room: RoomAttentionFields,
  previousRoom: RoomAttentionFields = room,
): number {
  // Overlapping operations share the last settled attention, never an
  // optimistic snapshot from a superseded operation or a remounted caller.
  const previousOverlay = getRoomReadOverlay(room.id);
  const rollbackAttention = previousOverlay?.pending?.rollbackAttention ?? {
    ...applyRoomReadOverlays([previousRoom])[0],
    updatedAt: new Date(
      Math.max(
        toUpdatedAtMs(previousRoom.updatedAt),
        previousOverlay?.updatedAtMs ?? 0,
      ),
    ),
  };
  const token = ++revision;
  storeAttention(room, token, {
    token,
    expiresAt: Date.now() + PENDING_ATTENTION_TIMEOUT_MS,
    rollbackAttention,
  });
  return token;
}

/** A replaced operation cannot restore or settle a newer read. */
export function settleRoomAttentionChange(
  roomId: string,
  token: number,
  room: RoomAttentionFields | null,
): boolean {
  const overlay = getRoomReadOverlay(roomId);
  if (overlay?.pending?.token !== token) {
    return false;
  }
  if (room) {
    storeAttention(room, ++revision);
  } else {
    storeAttention(overlay.pending.rollbackAttention, ++revision);
  }
  return true;
}

export function forgetRoomRead(roomId: string): void {
  overlaysByRoomId.delete(roomId);
}

export function clearRoomReadOverlays(): void {
  overlaysByRoomId.clear();
}

/** Capture before fetching, so a read started during that fetch still wins. */
export function beginRoomAttentionRefresh(): number {
  return ++revision;
}

/**
 * Fresh results can change attention without changing room activity, such as
 * Mark unread or Thread Look in another tab. Keep their attention for remounts.
 */
export function reconcileRoomAttention<T extends RoomAttentionFields>(
  rooms: readonly T[],
  requestRevision: number,
): T[] {
  return rooms.map((room) => {
    const overlay = getRoomReadOverlay(room.id);
    if (
      overlay &&
      (overlay.pending !== null || overlay.revision > requestRevision)
    ) {
      return applyAttention(room, overlay);
    }
    storeAttention(room, requestRevision);
    return room;
  });
}

/** Apply only to hydration and local snapshots, never authoritative fetches. */
export function applyRoomReadOverlays<T extends RoomAttentionFields>(
  rooms: readonly T[],
): T[] {
  return rooms.map((room) => {
    const overlay = getRoomReadOverlay(room.id);
    if (
      !overlay ||
      (overlay.pending === null &&
        toUpdatedAtMs(room.updatedAt) > overlay.updatedAtMs)
    ) {
      return room;
    }
    return applyAttention(room, overlay);
  });
}
