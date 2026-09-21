/**
 * The counts and marks a room's sidebar attention is resolved from.
 *
 * `unreadCount` is the sum of its two halves (ADR-0037). The halves are
 * optional because a room snapshot taken before the split carries only the
 * sum; every reader here falls back to it.
 */
export interface RoomAttentionCounts {
  unreadCount: number;
  /** Room unread: what reading the channel clears. */
  channelUnreadCount?: number;
  /** Thread unread: what a Look clears. */
  threadUnreadCount?: number;
  unreadMentionCount: number;
  markedUnread?: boolean;
}

/**
 * Sidebar attention chrome for a room row.
 * Bold = unread top-level activity, an unread mention, or forced unread;
 * badge = unread @mentions only. Thread replies do not bold a row (ADR-0037):
 * they are Thread unread, and they surface on the Thread.
 * Muted rooms suppress both (and Core skips CHAT mention notification creates).
 *
 * `unreadTextCount` is the reader's opt-in Room unread count, rendered as
 * muted text. It is a third field rather than a new meaning for `badgeCount`,
 * because the badge counts mentions and directs and keeps saying so:
 * `CONTEXT.md` lists using the mention badge as the message unread count under
 * *Avoid* for **Room unread**. A row shows one of the two, never both: the
 * badge when there is one, the count otherwise. Neither changes what the
 * other says.
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
  /**
   * Room unread: the channel half alone (ADR-0037). Bold and the reader's
   * opt-in number follow this, not the total, so reading a channel genuinely
   * quiets its row. Optional so a room snapshot that predates the split still
   * gets the old behaviour from the total.
   */
  channelUnreadCount?: number;
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

  const channelUnread = options.channelUnreadCount ?? options.unreadCount;

  return {
    // A User mention inside a Thread is the one escalation that reaches the
    // channel: being named is not chatter. A mention reply counts toward the
    // thread half, so without this term the split would quietly drop the
    // loudest thing a Thread can hold.
    bold:
      channelUnread > 0 ||
      options.unreadMentionCount > 0 ||
      options.markedUnread === true,
    badgeCount: options.unreadMentionCount,
    // One number per row. A badge is something addressed to the reader, and it
    // stands alone: beside it the message count was a second number in a
    // second colour, and bold already says there is more.
    unreadTextCount:
      options.showUnreadCount === true && options.unreadMentionCount === 0
        ? channelUnread
        : 0,
  };
}

/** Everything a room row holds about what is unread in it. */
type RoomUnreadState = RoomAttentionCounts & {
  unreadThreadCount?: number;
  unreadThreads?: unknown;
};

/**
 * A newer copy of a room, with what is unread carried over from the copy
 * already held.
 *
 * Opening a Direct, joining, creating and restoring each answer with the
 * room, and none of them counts what is unread: their zeros mean "not
 * counted". Taken as they come they would unbold a row and empty its inset
 * thread rows until the next poll.
 */
export function keepRoomUnreadState<T extends RoomUnreadState>(
  held: RoomUnreadState | undefined,
  incoming: T,
): T {
  if (!held) {
    return incoming;
  }
  return {
    ...incoming,
    unreadCount: held.unreadCount,
    channelUnreadCount: held.channelUnreadCount,
    threadUnreadCount: held.threadUnreadCount,
    unreadThreadCount: held.unreadThreadCount,
    unreadThreads: held.unreadThreads,
    unreadMentionCount: held.unreadMentionCount,
    markedUnread: held.markedUnread,
  };
}

/**
 * A room's attention the moment the reader reads it, before Core answers.
 *
 * Reading a channel empties Room unread, its mention badge, and a hand-set
 * unread mark. It does not Look the room's Threads, so Thread unread stays
 * and is all that is left of the total (ADR-0037). One rule for every place
 * that clears a row optimistically, so none of them can leave the channel
 * half behind and keep the row bold.
 */
export function roomAttentionAfterRead(
  room: RoomAttentionCounts,
): Required<RoomAttentionCounts> {
  const threadUnreadCount = room.threadUnreadCount ?? 0;
  return {
    unreadCount: threadUnreadCount,
    channelUnreadCount: 0,
    threadUnreadCount,
    unreadMentionCount: 0,
    markedUnread: false,
  };
}

/** What a closed sidebar section holds for the reader, or null for nothing. */
export type SectionAttention = "mention" | "unread" | null;

/**
 * A section's attention is its loudest room's, by the same rules a row
 * follows, so a closed heading cannot disagree with the rooms under it.
 * Mention wins, as it does on the Rail attention pill. A pending invitation
 * is addressed to the reader, so it counts as a mention.
 */
export function resolveSectionAttention(
  rooms: ReadonlyArray<RoomAttentionCounts & { mutedAt?: unknown }>,
  options: { hasPendingInvitation?: boolean } = {},
): SectionAttention {
  let unread = false;
  for (const room of rooms) {
    const { bold, badgeCount } = resolveRoomAttention({
      unreadCount: room.unreadCount,
      channelUnreadCount: room.channelUnreadCount,
      unreadMentionCount: room.unreadMentionCount,
      markedUnread: room.markedUnread,
      isMuted: room.mutedAt != null,
    });
    if (badgeCount > 0) return "mention";
    unread ||= bold;
  }
  if (options.hasPendingInvitation === true) return "mention";
  return unread ? "unread" : null;
}
