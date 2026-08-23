import type { ChatRoomMessageEventType } from "@sokosumi/utils";

import type { ChatRoomMessage } from "@/schemas/chat-room.schema";

/** Ably default ClientOptions.maxMessageSize (bytes). */
export const ABLY_MAX_MESSAGE_SIZE = 65_536;

export const CHAT_ROOM_MESSAGE_EVENT_NAME = "chat_room_message";

/** Metadata keys that dominate assistant/coworker create payloads. */
const HEAVY_METADATA_KEYS = ["reasoning", "ui_message_v1"] as const;

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

function fitsAbly(body: ChatRoomMessageFullEventBody): boolean {
  return (
    ablyPublishSize(CHAT_ROOM_MESSAGE_EVENT_NAME, body) <= ABLY_MAX_MESSAGE_SIZE
  );
}

function stripHeavyMetadata(message: ChatRoomMessage): ChatRoomMessage {
  const metadata = message.metadata;
  if (!metadata) {
    return message;
  }
  let changed = false;
  const next: Record<string, unknown> = { ...metadata };
  for (const key of HEAVY_METADATA_KEYS) {
    if (key in next) {
      delete next[key];
      changed = true;
    }
  }
  if (!changed) {
    return message;
  }
  return {
    ...message,
    metadata: Object.keys(next).length > 0 ? next : null,
  };
}

function clearPromotedExtras(message: ChatRoomMessage): ChatRoomMessage {
  if (
    message.quote == null &&
    message.unfurls == null &&
    message.membership == null
  ) {
    return message;
  }
  return {
    ...message,
    quote: null,
    unfurls: null,
    membership: null,
  };
}

function clearListExtras(message: ChatRoomMessage): ChatRoomMessage {
  if (message.reactions.length === 0 && message.mentions.length === 0) {
    return message;
  }
  return {
    ...message,
    reactions: [],
    mentions: [],
  };
}

/**
 * Binary-search the longest content prefix that keeps the full event under
 * Ably's max message size.
 */
function truncateContentToFit(
  eventType: ChatRoomMessageFullEventType,
  message: ChatRoomMessage,
): ChatRoomMessage {
  if (fitsAbly({ eventType, message })) {
    return message;
  }

  let lo = 0;
  let hi = message.content.length;
  let bestLength = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate: ChatRoomMessage = {
      ...message,
      content: message.content.slice(0, mid),
    };
    if (fitsAbly({ eventType, message: candidate })) {
      bestLength = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return {
    ...message,
    content: message.content.slice(0, bestLength),
  };
}

/**
 * Shrink a full chat_room_message Ably body until it fits maxMessageSize.
 * DB row stays untouched; room live-poll backstop hydrates full content.
 */
export function fitChatRoomMessageFullEvent(
  body: ChatRoomMessageFullEventBody,
): ChatRoomMessageFullEventBody {
  if (fitsAbly(body)) {
    return body;
  }

  let message = stripHeavyMetadata(body.message);
  let next: ChatRoomMessageFullEventBody = {
    eventType: body.eventType,
    message,
  };
  if (fitsAbly(next)) {
    return next;
  }

  message = clearPromotedExtras(message);
  next = { eventType: body.eventType, message };
  if (fitsAbly(next)) {
    return next;
  }

  if (message.metadata != null) {
    message = { ...message, metadata: null };
    next = { eventType: body.eventType, message };
    if (fitsAbly(next)) {
      return next;
    }
  }

  message = clearListExtras(message);
  next = { eventType: body.eventType, message };
  if (fitsAbly(next)) {
    return next;
  }

  message = truncateContentToFit(body.eventType, message);
  return { eventType: body.eventType, message };
}
