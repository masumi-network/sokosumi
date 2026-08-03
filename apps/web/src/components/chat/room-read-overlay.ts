/**
 * Session memory for rooms the client has successfully marked read.
 *
 * Mobile sidebar mounts OrganizationChatList inside a Sheet that unmounts when
 * closed. Mark-read then dispatches `organization-chat-room-read` with no
 * listener, and remount rehydrates from stale RSC props so unread flash back.
 * This overlay survives unmount and is reapplied on every list hydrate/poll.
 */

interface RoomReadOverlay {
  /** Room `updatedAt` at mark-read time. Newer activity invalidates the overlay. */
  updatedAtMs: number;
}

const overlaysByRoomId = new Map<string, RoomReadOverlay>();

function toUpdatedAtMs(updatedAt: string | Date): number {
  const ms = new Date(updatedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function rememberRoomRead(room: {
  id: string;
  updatedAt: string | Date;
}): void {
  overlaysByRoomId.set(room.id, {
    updatedAtMs: toUpdatedAtMs(room.updatedAt),
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
 * Reapply cleared attention for rooms marked read this session when the
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
      room.unreadCount === 0 &&
      room.unreadMentionCount === 0 &&
      room.markedUnread === false
    ) {
      overlaysByRoomId.delete(room.id);
      return room;
    }

    return {
      ...room,
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
    };
  });
}
