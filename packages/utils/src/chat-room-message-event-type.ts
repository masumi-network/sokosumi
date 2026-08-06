/**
 * Stable intent for Ably `chat_room_message` publishes (SOK-736).
 * create/update/delete carry a full message DTO; reaction/unfurl/
 * mention_status carry a field patch (SOK-737).
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
