/**
 * One pass of the All unreads filter, from switching it on to switching it
 * off (SOK-1159).
 *
 * `seen` is every room that was unread at some point in the pass, in the
 * order the filter lists them. A room read since stays in its place, dimmed,
 * so nothing moves out from under the reader. Held in the browser only, and
 * dropped with the pass, because it is about these few minutes and nothing
 * else.
 */
export interface UnreadFilterPass {
  readonly seen: readonly string[];
}

export const EMPTY_UNREAD_FILTER_PASS: UnreadFilterPass = { seen: [] };

/**
 * The pass after the rooms moved.
 *
 * `unreadIds` comes newest activity first. The first call lists them in that
 * order; a room that turns unread later goes on top. A room already listed
 * keeps its place whether it is read, unread again, or active again, so the
 * list only ever grows at the top. Answers with the same object when nothing
 * moved, so a render can compare and skip the update.
 */
export function advanceUnreadFilterPass(
  pass: UnreadFilterPass,
  { unreadIds }: { unreadIds: readonly string[] },
): UnreadFilterPass {
  const listed = new Set(pass.seen);
  const arrived = unreadIds.filter((id) => !listed.has(id));
  return arrived.length > 0 ? { seen: [...arrived, ...pass.seen] } : pass;
}
