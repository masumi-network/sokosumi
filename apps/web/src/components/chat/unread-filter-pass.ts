/**
 * One pass of the All unreads filter, from switching it on to switching it
 * off (SOK-1159).
 *
 * `seen` is every room that was unread at some point in the pass. `justRead`
 * is the ones among them read since, newest first: the filter lists them
 * dimmed under Just read, so a room the reader has just finished does not
 * vanish from under them. Held in the browser only, and dropped with the
 * pass, because it is about these few minutes and nothing else.
 */
export interface UnreadFilterPass {
  readonly seen: readonly string[];
  readonly justRead: readonly string[];
}

export const EMPTY_UNREAD_FILTER_PASS: UnreadFilterPass = {
  seen: [],
  justRead: [],
};

/**
 * The pass after the rooms moved.
 *
 * A room joins `justRead` once it was seen unread, is read now, and is not
 * the open room: that one keeps its own place in the list while the reader is
 * in it, and moves down when they leave. A room turning unread again goes
 * back to the filter proper. Answers with the same object when nothing moved,
 * so a render can compare and skip the update.
 */
export function advanceUnreadFilterPass(
  pass: UnreadFilterPass,
  {
    unreadIds,
    activeRoomId,
  }: { unreadIds: readonly string[]; activeRoomId: string | null },
): UnreadFilterPass {
  const unread = new Set(unreadIds);
  const seenNow = [
    ...pass.seen,
    ...unreadIds.filter((id) => !pass.seen.includes(id)),
  ];
  const stillJustRead = pass.justRead.filter((id) => !unread.has(id));
  const newlyRead = pass.seen.filter(
    (id) =>
      !unread.has(id) && id !== activeRoomId && !stillJustRead.includes(id),
  );
  const justRead = [...newlyRead, ...stillJustRead];

  const moved =
    seenNow.length !== pass.seen.length ||
    justRead.length !== pass.justRead.length ||
    justRead.some((id, index) => id !== pass.justRead[index]);
  return moved ? { seen: seenNow, justRead } : pass;
}
