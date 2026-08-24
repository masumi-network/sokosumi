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

/** Over-limit create/update/delete: identity only (ADR 0014). */
export interface ChatRoomMessageIdEnvelope {
  eventType: ChatRoomMessageFullEventType;
  messageId: string;
  roomId: string;
  parentMessageId: string | null;
}

export type ChatRoomMessagePublishBody =
  | ChatRoomMessageFullEventBody
  | ChatRoomMessageIdEnvelope;

/**
 * Ably REST publish size before HTTP: event name length + UTF-8 bytes of
 * JSON-encoded data (see ably getMessageSize / dataSizeBytes).
 */
export function ablyPublishSize(name: string, data: unknown): number {
  const encoded =
    typeof data === "string" ? data : JSON.stringify(data ?? null);
  return name.length + Buffer.byteLength(encoded, "utf8");
}

export function isChatRoomMessageIdEnvelope(
  body: ChatRoomMessagePublishBody,
): body is ChatRoomMessageIdEnvelope {
  return !("message" in body);
}

/**
 * Full DTO when it fits maxMessageSize; otherwise an id envelope.
 * Does not shrink or truncate the DTO (ADR 0014).
 */
export function chatRoomMessagePublishBody(
  eventType: ChatRoomMessageFullEventType,
  message: ChatRoomMessage,
): ChatRoomMessagePublishBody {
  const full: ChatRoomMessageFullEventBody = { eventType, message };
  const bytes = ablyPublishSize(CHAT_ROOM_MESSAGE_EVENT_NAME, full);
  if (bytes <= ABLY_MAX_MESSAGE_SIZE) {
    return full;
  }
  return {
    eventType,
    messageId: message.id,
    roomId: message.roomId,
    parentMessageId: message.parentMessageId,
  };
}
