/**
 * Thread-overview attention uses Core `attentionReplyCount` only — the same
 * dual-baseline non-self reply predicate as `markAllChatRoomThreadsRead`.
 * Never-looked alone is not enough: pre-join / self-only replies stay clear.
 */
export function threadNeedsOverviewAttention(thread: {
  attentionReplyCount: number;
}): boolean {
  return thread.attentionReplyCount > 0;
}

/** Qualifying unread-reply count for overview unread copy (Mark all / chrome). */
export function threadOverviewAttentionReplyCount(thread: {
  attentionReplyCount: number;
}): number {
  return Math.max(0, thread.attentionReplyCount);
}
