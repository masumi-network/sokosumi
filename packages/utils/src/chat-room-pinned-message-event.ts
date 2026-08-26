/**
 * Ably contract for Channel pinned-message list changes.
 * Core publishes; web parses — keep event name and actions in one place.
 */

export const CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME = "chat_room_pinned_message";

export const CHAT_ROOM_PINNED_MESSAGE_ACTIONS = ["pin", "unpin"] as const;

export type ChatRoomPinnedMessageAction =
  (typeof CHAT_ROOM_PINNED_MESSAGE_ACTIONS)[number];
