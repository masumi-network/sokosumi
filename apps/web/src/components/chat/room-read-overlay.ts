/**
 * Session memory for rooms this client has marked read.
 *
 * Mobile Chats unmounts the list while a room is open. Remount hydrates from
 * stale RSC unread. Overlay survives unmount and is reapplied on every list
 * hydrate/poll. Stores post-read attention (including leftover Participant
 * Thread unread), not only a full clear.
 */

interface RoomReadOverlay {
  /** Room `updatedAt` at mark-read time. Newer activity invalidates the overlay. */
  updatedAtMs: number;
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread: boolean;
}

const overlaysByRoomId = new Map<string, RoomReadOverlay>();

function toUpdatedAtMs(updatedAt: string | Date): number {
  const ms = new Date(updatedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function rememberRoomRead(room: {
  id: string;
  updatedAt: string | Date;
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread: boolean;
}): void {
  overlaysByRoomId.set(room.id, {
    updatedAtMs: toUpdatedAtMs(room.updatedAt),
    unreadCount: room.unreadCount,
    unreadMentionCount: room.unreadMentionCount,
    markedUnread: room.markedUnread,
  });
}

export function forgetRoomRead(roomId: string): void {
  overlaysByRoomId.delete(roomId);
}

export function clearRoomReadOverlays(): void {
  overlaysByRoomId.clear();
}

interface RoomAttentionFields {
  id: string;
  updatedAt: string | Date;
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread: boolean;
}

/**
 * Reapply post-read attention for rooms marked read this session when the
 * incoming list is stale (same or older `updatedAt`). Real new activity
 * (newer `updatedAt`) drops the overlay and trusts the server row.
 */
export function applyRoomReadOverlays<T extends RoomAttentionFields>(
  rooms: readonly T[],
): T[] {
  if (overlaysByRoomId.size === 0) {
    return rooms as T[];
  }

  return rooms.map((room) => {
    const overlay = overlaysByRoomId.get(room.id);
    if (!overlay) {
      return room;
    }

    const incomingUpdatedAtMs = toUpdatedAtMs(room.updatedAt);
    if (incomingUpdatedAtMs > overlay.updatedAtMs) {
      overlaysByRoomId.delete(room.id);
      return room;
    }

    if (
      (room.unreadCount === 0 &&
        room.unreadMentionCount === 0 &&
        room.markedUnread === false) ||
      (room.unreadCount === overlay.unreadCount &&
        room.unreadMentionCount === overlay.unreadMentionCount &&
        room.markedUnread === overlay.markedUnread)
    ) {
      overlaysByRoomId.delete(room.id);
      return room;
    }

    return {
      ...room,
      unreadCount: overlay.unreadCount,
      unreadMentionCount: overlay.unreadMentionCount,
      markedUnread: overlay.markedUnread,
    };
  });
}
