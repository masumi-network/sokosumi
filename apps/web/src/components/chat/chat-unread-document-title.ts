interface ChatRoomUnreadAttention {
  id: string;
  unreadCount: number;
  markedUnread?: boolean;
  mutedAt?: string | Date | null;
}

/**
 * Count rooms that would show sidebar attention (bold), for the tab title.
 * One per room, not a sum of unread messages. Skips muted rooms only: the room
 * the reader has open is counted like any other, because `resolveRoomAttention`
 * bolds it like any other. Opening a room does not read it, and the tab title
 * has to agree with the row it summarises.
 */
export function countChatRoomsWithUnreadAttention(
  rooms: readonly ChatRoomUnreadAttention[],
): number {
  let total = 0;

  for (const room of rooms) {
    if (room.mutedAt != null) {
      continue;
    }

    if (room.unreadCount > 0 || room.markedUnread === true) {
      total += 1;
    }
  }

  return total;
}

const CHAT_UNREAD_TITLE_PREFIX_RE = /^\(\d+\) /;

export function stripChatUnreadTitlePrefix(title: string): string {
  return title.replace(CHAT_UNREAD_TITLE_PREFIX_RE, "");
}

export function formatChatUnreadDocumentTitle(
  currentTitle: string,
  unreadTotal: number,
): string {
  const base = stripChatUnreadTitlePrefix(currentTitle);
  if (unreadTotal > 0) {
    return `(${unreadTotal}) ${base}`;
  }
  return base;
}
