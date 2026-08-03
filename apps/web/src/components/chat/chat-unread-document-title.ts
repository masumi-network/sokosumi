interface ChatRoomUnreadAttention {
  id: string;
  unreadCount: number;
  markedUnread?: boolean;
  mutedAt?: string | Date | null;
}

interface CountChatRoomsWithUnreadAttentionOptions {
  activeRoomId?: string | null;
}

/**
 * Count rooms that would show sidebar attention (bold), for the tab title.
 * One per room — not a sum of unread messages. Skips active and muted rooms.
 */
export function countChatRoomsWithUnreadAttention(
  rooms: ChatRoomUnreadAttention[],
  options: CountChatRoomsWithUnreadAttentionOptions = {},
): number {
  let total = 0;

  for (const room of rooms) {
    if (options.activeRoomId != null && room.id === options.activeRoomId) {
      continue;
    }

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
