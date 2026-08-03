/**
 * Sidebar attention chrome for a room row.
 * Bold = unread activity or forced unread; badge = unread @mentions only.
 * Muted rooms suppress both (and Core skips CHAT mention notification creates).
 */
export function resolveRoomAttention(options: {
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread?: boolean;
  isMuted?: boolean;
  isActive: boolean;
}): { bold: boolean; badgeCount: number } {
  if (options.isActive || options.isMuted === true) {
    return { bold: false, badgeCount: 0 };
  }

  return {
    bold: options.unreadCount > 0 || options.markedUnread === true,
    badgeCount: options.unreadMentionCount,
  };
}
