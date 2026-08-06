/**
 * Stable intent for Ably `chat_room_message` publishes.
 * Full message DTO remains the payload body; this field is the shared
 * publisher/consumer contract so clients do not guess create vs edit vs
 * reaction vs unfurl (SOK-736).
 */
export const CHAT_ROOM_MESSAGE_EVENT_TYPES = [
  "create",
  "update",
  "delete",
  "reaction",
  "unfurl",
  "mention_status",
] as const;

export type ChatRoomMessageEventType =
  (typeof CHAT_ROOM_MESSAGE_EVENT_TYPES)[number];
