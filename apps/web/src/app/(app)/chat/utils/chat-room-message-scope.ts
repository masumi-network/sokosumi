/**
 * Room timeline vs thread panel message scope.
 *
 * Main room transcript is top-level only (`parentMessageId == null`).
 * Thread replies belong only in the open thread panel. Realtime must not
 * merge replies into room state — otherwise a send from the thread panel
 * appears in both the room and the thread.
 */

export function isTopLevelChatRoomMessage(message: {
  parentMessageId?: string | null;
}): boolean {
  return message.parentMessageId == null;
}

/** Whether Ably/realtime should merge this message into the main room list. */
export function shouldMergeRealtimeMessageIntoRoomTimeline(message: {
  parentMessageId?: string | null;
}): boolean {
  return isTopLevelChatRoomMessage(message);
}

/** Whether realtime should merge into the currently open thread panel. */
export function shouldApplyRealtimeMessageToOpenThread(
  message: {
    id: string;
    parentMessageId?: string | null;
  },
  openThreadParentId: string | null,
): boolean {
  if (!openThreadParentId) {
    return false;
  }
  return (
    message.id === openThreadParentId ||
    message.parentMessageId === openThreadParentId
  );
}
