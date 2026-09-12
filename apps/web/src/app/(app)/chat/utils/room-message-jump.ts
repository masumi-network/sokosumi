export interface RoomMessageJumpDeps {
  /**
   * True when the message is already rendered, so nothing needs loading.
   * False also when a later jump has replaced this one, which is the caller's
   * way of saying this jump no longer speaks for the reader.
   */
  highlight: (messageId: string) => boolean;
  holdOffBottom: () => void;
  releaseHoldOffBottom: () => void;
  /**
   * False when the window could not be loaded, when the room moved under it,
   * or when a later jump replaced this one.
   */
  loadAround: (messageId: string) => Promise<boolean>;
  /**
   * Settle after the window is merged, before the highlight scrolls to it.
   * Takes no message id so the caller waits three frames rather than
   * returning the moment the target exists. The stick-to-bottom
   * observer has to see the whole growth while the hold is still on, or it
   * re-pins the view to the newest message and undoes the jump.
   */
  afterRender: () => Promise<void>;
}

/**
 * Put one message on screen and highlight it.
 *
 * A message the reader can already see needs no load and no hold: highlighting
 * it is the whole job. Anything older is fetched as a window around it, which
 * is why the hold is taken first. Without it the room would stick to the
 * newest message and drag the reader away from what they came for.
 *
 * The hold is released on every path once taken, including the one that
 * arrives. A room left holding off the bottom stops following new messages.
 *
 * Reached from the pinned list and from a notification that named the message
 * on the room's URL. The thread case belongs to `performRoomSearchJump`, which
 * needs the parent to open the panel first.
 *
 * Resolves true once the message is on screen. The pinned list waits on that
 * to close itself, and stays open when the jump gave up so the row the reader
 * tapped is still there to tap again.
 */
export async function performRoomMessageJump(
  messageId: string,
  deps: RoomMessageJumpDeps,
): Promise<boolean> {
  if (deps.highlight(messageId)) {
    return true;
  }

  deps.holdOffBottom();
  try {
    if (!(await deps.loadAround(messageId))) {
      return false;
    }
    await deps.afterRender();
    return deps.highlight(messageId);
  } finally {
    deps.releaseHoldOffBottom();
  }
}
