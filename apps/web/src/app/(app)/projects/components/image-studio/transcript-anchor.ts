/**
 * Holding a reader's place in a bottom-anchored transcript.
 *
 * The scroller is the one direct messages use: `flex-col-reverse`, so
 * `scrollTop` is 0 at the newest message and negative above it. That alone
 * stops an arriving message from yanking the view back to the bottom — the
 * number does not change. But it is not enough. The content column is pinned
 * to the bottom of the scroller, so when the assistant adds a paragraph the
 * column grows *downward into the anchor* and everything above it slides up.
 * Someone reading three messages back watches the text walk out from under
 * them, which is the complaint even though the scroll position never moved.
 *
 * Subtracting the growth restores the pixel they were looking at. It is done
 * only while they are parked above the newest message: at the bottom, growth
 * is the new message arriving, and following it is the whole point.
 */

/**
 * How far above the newest message counts as "reading back".
 *
 * A few pixels of overscroll or a half-line of rubber-banding is not a
 * decision to stop following the conversation.
 */
export const SCROLLED_UP_THRESHOLD_PX = 80;

export function isScrolledUp(scrollTop: number): boolean {
  return scrollTop < -SCROLLED_UP_THRESHOLD_PX;
}

/**
 * The `scrollTop` that keeps the same content on screen, or `null` when
 * nothing should be written.
 *
 * Returning `null` rather than the current value matters: every write to
 * `scrollTop` is a write the browser may be in the middle of a touch scroll
 * for, and the cheapest way not to fight one is not to make it.
 */
export function heldScrollTop(input: {
  scrollTop: number;
  previousHeight: number;
  nextHeight: number;
}): number | null {
  const growth = input.nextHeight - input.previousHeight;
  // Shrinking, unchanged, or a first measurement with nothing to compare to.
  if (growth <= 0 || input.previousHeight === 0) return null;
  // At the bottom, following the conversation is the correct behaviour.
  if (!isScrolledUp(input.scrollTop)) return null;
  return input.scrollTop - growth;
}
