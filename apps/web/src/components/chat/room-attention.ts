/**
 * Sidebar attention chrome for a room row.
 * Bold = top-level unread or forced unread (not thread replies).
 * Badge = unread @mentions only.
 * Thread indicator = unreadThreadReplyCount > 0 (distinct from channel bold).
 * Muted / active rooms suppress all chrome (and Core skips CHAT mention creates).
 */
export function resolveRoomAttention(options: {
  unreadCount: number;
  unreadThreadReplyCount?: number;
  unreadMentionCount: number;
  markedUnread?: boolean;
  isMuted?: boolean;
  isActive: boolean;
}): {
  bold: boolean;
  badgeCount: number;
  threadUnreadCount: number;
} {
  if (options.isActive || options.isMuted === true) {
    return { bold: false, badgeCount: 0, threadUnreadCount: 0 };
  }

  return {
    bold: options.unreadCount > 0 || options.markedUnread === true,
    badgeCount: options.unreadMentionCount,
    threadUnreadCount: Math.max(0, options.unreadThreadReplyCount ?? 0),
  };
}
