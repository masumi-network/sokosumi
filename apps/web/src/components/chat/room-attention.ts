/**
 * Sidebar attention chrome for a room row.
 * Bold = unread activity or forced unread; badge = unread @mentions only.
 */
export function resolveRoomAttention(options: {
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread?: boolean;
  isActive: boolean;
}): { bold: boolean; badgeCount: number } {
  if (options.isActive) {
    return { bold: false, badgeCount: 0 };
  }

  return {
    bold: options.unreadCount > 0 || options.markedUnread === true,
    badgeCount: options.unreadMentionCount,
  };
}
