/**
 * Room timeline vs thread panel message scope.
 *
 * Main room transcript is top-level only (`parentMessageId == null`).
 * Thread replies belong only in the open thread panel. Realtime must not
 * merge replies into room state — otherwise a send from the thread panel
 * appears in both the room and the thread.
 *
 * Open-thread parent updates (reaction/edit) update `threadParentMessage` and
 * the room timeline — never the replies array (that would duplicate the root).
 */

export function isTopLevelChatRoomMessage(message: {
  parentMessageId?: string | null;
}): boolean {
  return message.parentMessageId == null;
}

/** Drop thread replies from a room-timeline candidate list. */
export function filterTopLevelChatRoomMessages<
  T extends { parentMessageId?: string | null },
>(messages: readonly T[]): T[] {
  return messages.filter(isTopLevelChatRoomMessage);
}

/** Stream overlay / reply rows under a specific thread root. */
export function isReplyUnderThreadParent(
  message: { parentMessageId?: string | null },
  parentMessageId: string,
): boolean {
  return message.parentMessageId === parentMessageId;
}

/**
 * Whether realtime should merge into the open thread *replies* list.
 *
 * Replies only. The thread root is rendered from `threadParentMessage` and
 * must never enter the replies array — otherwise a parent reaction/edit Ably
 * event duplicates the root under the divider (SOK thread-parent reaction bug).
 */
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
  return isReplyUnderThreadParent(message, openThreadParentId);
}

export interface RealtimeChatRoomMessageRoute {
  /** Main room list: top-level messages only. */
  mergeIntoRoomTimeline: boolean;
  /**
   * Open thread replies list only (never the parent row).
   * Parent updates use `threadParentMessage` / room timeline separately.
   */
  mergeIntoOpenThread: boolean;
}

/**
 * Decide where a realtime chat-room message should land.
 * Single seam for rooms-client Ably handling — unit-test this, not string grep.
 */
export function routeRealtimeChatRoomMessage(
  message: {
    id: string;
    parentMessageId?: string | null;
  },
  openThreadParentId: string | null,
): RealtimeChatRoomMessageRoute {
  return {
    mergeIntoRoomTimeline: isTopLevelChatRoomMessage(message),
    mergeIntoOpenThread: shouldApplyRealtimeMessageToOpenThread(
      message,
      openThreadParentId,
    ),
  };
}
