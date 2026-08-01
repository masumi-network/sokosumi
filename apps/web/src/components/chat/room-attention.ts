/**
 * Sidebar attention chrome for a room row.
 * Bold = unread activity; badge = unread @mentions only.
 */
export function resolveRoomAttention(options: {
  unreadCount: number;
  unreadMentionCount: number;
  isActive: boolean;
}): { bold: boolean; badgeCount: number } {
  if (options.isActive) {
    return { bold: false, badgeCount: 0 };
  }

  return {
    bold: options.unreadCount > 0,
    badgeCount: options.unreadMentionCount,
  };
}
