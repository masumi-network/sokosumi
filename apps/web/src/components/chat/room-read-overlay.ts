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

interface RoomAttentionFields {
  id: string;
  updatedAt: string | Date;
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread: boolean;
}

export function rememberRoomRead(room: RoomAttentionFields): void {
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

/**
 * Reapply post-read attention when the incoming list is stale (same or older
 * `updatedAt`). Newer activity drops the overlay. A fully-clear incoming row
 * only drops a fully-clear overlay — leftover Thread unread must not be wiped
 * by a stale empty cache.
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

    const overlayFullyClear =
      overlay.unreadCount === 0 &&
      overlay.unreadMentionCount === 0 &&
      overlay.markedUnread === false;
    const incomingFullyClear =
      room.unreadCount === 0 &&
      room.unreadMentionCount === 0 &&
      room.markedUnread === false;
    if (overlayFullyClear && incomingFullyClear) {
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
