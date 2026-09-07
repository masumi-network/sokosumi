/** Session attention snapshots protect remounts from stale server props. */
interface RoomReadOverlay {
  updatedAtMs: number;
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread: boolean;
  revision: number;
  pendingToken: number | null;
}

interface RoomAttentionFields {
  id: string;
  updatedAt: string | Date;
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread: boolean;
}

const overlaysByRoomId = new Map<string, RoomReadOverlay>();
let revision = 0;

function toUpdatedAtMs(updatedAt: string | Date): number {
  const ms = new Date(updatedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function storeAttention(
  room: RoomAttentionFields,
  nextRevision: number,
  pendingToken: number | null = null,
): void {
  overlaysByRoomId.set(room.id, {
    updatedAtMs: toUpdatedAtMs(room.updatedAt),
    unreadCount: room.unreadCount,
    unreadMentionCount: room.unreadMentionCount,
    markedUnread: room.markedUnread,
    revision: nextRevision,
    pendingToken,
  });
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
  storeAttention(
    room,
    ++revision,
    overlaysByRoomId.get(room.id)?.pendingToken ?? null,
  );
}

export function beginRoomAttentionChange(room: RoomAttentionFields): number {
  const token = ++revision;
  storeAttention(room, token, token);
  return token;
}

/** A replaced operation cannot restore or settle a newer read. */
export function settleRoomAttentionChange(
  roomId: string,
  token: number,
  room: RoomAttentionFields | null,
): boolean {
  if (overlaysByRoomId.get(roomId)?.pendingToken !== token) {
    return false;
  }
  if (room) {
    storeAttention(room, ++revision);
  } else {
    forgetRoomRead(roomId);
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
    const overlay = overlaysByRoomId.get(room.id);
    if (
      overlay &&
      (overlay.pendingToken !== null || overlay.revision > requestRevision)
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
    const overlay = overlaysByRoomId.get(room.id);
    if (
      !overlay ||
      (overlay.pendingToken === null &&
        toUpdatedAtMs(room.updatedAt) > overlay.updatedAtMs)
    ) {
      return room;
    }
    return applyAttention(room, overlay);
  });
}
