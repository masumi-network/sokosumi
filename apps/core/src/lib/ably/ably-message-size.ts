import type { ChatRoomMessageEventType } from "@sokosumi/utils";

import type { ChatRoomMessage } from "@/schemas/chat-room.schema";

/** Ably default ClientOptions.maxMessageSize (bytes). */
export const ABLY_MAX_MESSAGE_SIZE = 65_536;

export const CHAT_ROOM_MESSAGE_EVENT_NAME = "chat_room_message";

export type ChatRoomMessageFullEventType = Extract<
  ChatRoomMessageEventType,
  "create" | "update" | "delete"
>;

export interface ChatRoomMessageFullEventBody {
  eventType: ChatRoomMessageFullEventType;
  message: ChatRoomMessage;
}

/**
 * Ably REST publish size before HTTP: event name length + UTF-8 bytes of
 * JSON-encoded data (see ably getMessageSize / dataSizeBytes).
 */
export function ablyPublishSize(name: string, data: unknown): number {
  const encoded =
    typeof data === "string" ? data : JSON.stringify(data ?? null);
  return name.length + Buffer.byteLength(encoded, "utf8");
}

/**
 * Stub: returns the body unchanged. Oversized payloads still exceed Ably's
 * limit — implement fit in the next commit (SOKOSUMI-CORE-38).
 */
export function fitChatRoomMessageFullEvent(
  body: ChatRoomMessageFullEventBody,
): ChatRoomMessageFullEventBody {
  return body;
}
