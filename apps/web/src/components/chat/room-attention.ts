/**
 * Sidebar attention chrome for a room row.
 * Bold = unread activity or forced unread; badge = unread @mentions only.
 * Muted rooms suppress both (and Core skips CHAT mention notification creates).
 *
 * `unreadTextCount` is the reader's opt-in Room unread count, rendered as text
 * beside the badge. It is a third field rather than a new meaning for
 * `badgeCount`, because the badge counts mentions and directs and keeps saying
 * so: `CONTEXT.md` lists using the mention badge as the message unread count
 * under *Avoid* for **Room unread**. Both numbers can sit on one row, and
 * neither changes what the other says.
 *
 * Having the room open is not a reason to drop the chrome. Opening a room does
 * not read it: the read baseline moves when the reader actually looks, and
 * until it moves the room still holds something. Hiding the mark on the active
 * row made the reader's own room the one place the count could not be trusted,
 * and it came back the moment they clicked away. Bold, badge, and count now
 * follow the unread state alone, so they go quiet only when the room is
 * genuinely read, marked read, or muted.
 *
 * Nothing here reads the room kind, so Channels, External channels, and every
 * Direct are covered by construction, and a future kind is covered for free.
 */
export function resolveRoomAttention(options: {
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread?: boolean;
  isMuted?: boolean;
  showUnreadCount?: boolean;
}): { bold: boolean; badgeCount: number; unreadTextCount: number } {
  // Muted suppression stays one early return, so the count cannot drift from
  // the two fields that already obey it.
  if (options.isMuted === true) {
    return { bold: false, badgeCount: 0, unreadTextCount: 0 };
  }

  return {
    bold: options.unreadCount > 0 || options.markedUnread === true,
    badgeCount: options.unreadMentionCount,
    unreadTextCount: options.showUnreadCount === true ? options.unreadCount : 0,
  };
}
