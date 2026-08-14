/**
 * Whether a thread row needs attention chrome in the room thread overview.
 * ADR-0005 zeros unreadReplyCount for never-looked threads; those still need
 * a look so Mark all / overview styling can clear sidebar dual-baseline unread.
 */
export function threadNeedsOverviewAttention(thread: {
  unreadReplyCount: number;
  hasLooked: boolean;
}): boolean {
  return thread.unreadReplyCount > 0 || thread.hasLooked === false;
}
