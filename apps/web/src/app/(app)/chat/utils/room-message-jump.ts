export interface RoomMessageJumpDeps {
  /** True when the message is already rendered, so nothing needs loading. */
  highlight: (messageId: string) => boolean;
  holdOffBottom: () => void;
  releaseHoldOffBottom: () => void;
  /** False when the window could not be loaded, or the room moved under it. */
  loadAround: (messageId: string) => Promise<boolean>;
  /**
   * Settle after the window is merged, before the highlight scrolls to it.
   * Takes no message id so the caller waits for the room to stop moving
   * rather than returning the moment the target exists. The stick-to-bottom
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
 */
export async function performRoomMessageJump(
  messageId: string,
  deps: RoomMessageJumpDeps,
): Promise<void> {
  if (deps.highlight(messageId)) {
    return;
  }

  deps.holdOffBottom();
  try {
    if (!(await deps.loadAround(messageId))) {
      return;
    }
    await deps.afterRender();
    deps.highlight(messageId);
  } finally {
    deps.releaseHoldOffBottom();
  }
}
