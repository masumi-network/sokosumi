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
 *
 * ## Realtime routing table (SOK-736)
 *
 * Ably `chat_room_message` carries `eventType` + full message DTO. Landing
 * (where the upsert goes) is decided by parent vs reply + open thread id;
 * `eventType` documents mutation intent (create/update/reaction/…) so clients
 * do not guess from DTO shape alone. v1 apply is still full-DTO upsert for
 * every type.
 *
 * | eventType (any) | message shape              | open thread        | room timeline | open thread replies | thread parent row* |
 * |-----------------|----------------------------|--------------------|---------------|---------------------|--------------------|
 * | *               | top-level (`parent` null)  | none / other       | yes           | no                  | no                 |
 * | *               | top-level (`parent` null)  | this message id    | yes           | **no** (not reply)  | yes (id match)     |
 * | *               | reply under open parent    | that parent        | no            | yes                 | no                 |
 * | *               | reply under other parent   | none / other       | no            | no                  | no                 |
 *
 * \* Parent row updates are `setThreadParentMessage` when `current.id === message.id`,
 * not via `mergeIntoOpenThread`.
 */

import type { ChatRoomMessageEventType } from "@/lib/ably/schema";

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
 *
 * `eventType` is part of the contract (validated upstream). Landing for v1 is
 * parent/reply based for every type; keep the param so tests lock create /
 * update / reaction matrices and future type-specific apply can extend here.
 */
export function routeRealtimeChatRoomMessage(
  message: {
    id: string;
    parentMessageId?: string | null;
  },
  openThreadParentId: string | null,
  eventType: ChatRoomMessageEventType,
): RealtimeChatRoomMessageRoute {
  // Contract param: Ably schema validates; v1 landing is parent/reply only.
  void eventType;
  return {
    mergeIntoRoomTimeline: isTopLevelChatRoomMessage(message),
    mergeIntoOpenThread: shouldApplyRealtimeMessageToOpenThread(
      message,
      openThreadParentId,
    ),
  };
}
