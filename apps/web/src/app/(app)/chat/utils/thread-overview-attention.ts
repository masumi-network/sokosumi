/**
 * Whether a thread row needs attention chrome in the room thread overview.
 *
 * Prefer `attentionReplyCount` (dual-baseline, includes never-looked replies
 * that still badge the sidebar). Fall back to ADR-0005 unread + never-looked
 * (`!hasLooked`) when older payloads omit attentionReplyCount.
 */
export function threadNeedsOverviewAttention(thread: {
  unreadReplyCount: number;
  hasLooked?: boolean;
  attentionReplyCount?: number;
}): boolean {
  if (
    typeof thread.attentionReplyCount === "number" &&
    thread.attentionReplyCount > 0
  ) {
    return true;
  }

  if (thread.unreadReplyCount > 0) {
    return true;
  }

  return thread.hasLooked === false;
}

/** Reply count to show in overview unread copy for an attention row. */
export function threadOverviewAttentionReplyCount(thread: {
  unreadReplyCount: number;
  replyCount: number;
  attentionReplyCount?: number;
}): number {
  if (
    typeof thread.attentionReplyCount === "number" &&
    thread.attentionReplyCount > 0
  ) {
    return thread.attentionReplyCount;
  }
  if (thread.unreadReplyCount > 0) {
    return thread.unreadReplyCount;
  }
  return thread.replyCount;
}
