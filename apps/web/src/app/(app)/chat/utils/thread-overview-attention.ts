/**
 * Thread-overview unread uses Core `unreadReplyCount` — Participant-gated
 * dual-baseline (ADR-0012). Lurkers stay 0 even if they Looked.
 */
export function threadNeedsOverviewAttention(thread: {
  unreadReplyCount: number;
}): boolean {
  return thread.unreadReplyCount > 0;
}

/** Qualifying unread-reply count for overview unread copy (Mark all / chrome). */
export function threadOverviewAttentionReplyCount(thread: {
  unreadReplyCount: number;
}): number {
  return Math.max(0, thread.unreadReplyCount);
}
