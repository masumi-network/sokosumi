const PENDING_ROOM_MESSAGE_KEY_PREFIX = "chat-room-pending-message:";

export function pendingRoomMessageStorageKey(roomId: string): string {
  return `${PENDING_ROOM_MESSAGE_KEY_PREFIX}${roomId}`;
}

/** Stash draft text so the room pane can stream it after navigate. */
export function stashPendingRoomMessage(roomId: string, content: string): void {
  const trimmed = content.trim();
  if (!trimmed || typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      pendingRoomMessageStorageKey(roomId),
      trimmed,
    );
  } catch {
    // private mode / quota — room pane just won't auto-send
  }
}

export function peekPendingRoomMessage(roomId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const value = window.sessionStorage.getItem(
      pendingRoomMessageStorageKey(roomId),
    );
    if (value == null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function clearPendingRoomMessage(roomId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(pendingRoomMessageStorageKey(roomId));
  } catch {
    // ignore
  }
}

/** Take pending draft text once (clears storage). */
export function takePendingRoomMessage(roomId: string): string | null {
  const value = peekPendingRoomMessage(roomId);
  if (value != null) {
    clearPendingRoomMessage(roomId);
  }
  return value;
}
