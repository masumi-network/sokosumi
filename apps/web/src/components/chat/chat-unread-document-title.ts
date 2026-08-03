interface ChatRoomUnreadAttention {
  id: string;
  unreadCount: number;
  markedUnread?: boolean;
}

interface SumChatRoomsUnreadAttentionOptions {
  activeRoomId?: string | null;
}

export function sumChatRoomsUnreadAttention(
  rooms: ChatRoomUnreadAttention[],
  options: SumChatRoomsUnreadAttentionOptions = {},
): number {
  let total = 0;

  for (const room of rooms) {
    if (options.activeRoomId != null && room.id === options.activeRoomId) {
      continue;
    }

    if (room.markedUnread === true && room.unreadCount === 0) {
      total += 1;
      continue;
    }

    total += room.unreadCount;
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
