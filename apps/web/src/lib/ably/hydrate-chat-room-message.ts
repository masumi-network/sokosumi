import type { ChatRoomMessageEventData } from "@/lib/ably/schema";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

function toDate(value: string): Date {
  return new Date(value);
}

function toNullableDate(value: string | null): Date | null {
  return value == null ? null : new Date(value);
}

/**
 * Ably JSON carries ISO strings; Core client DTOs use Date for the same fields.
 */
export function hydrateChatRoomMessageFromRealtime(
  message: ChatRoomMessageEventData["message"],
): ChatRoomMessage {
  return {
    id: message.id,
    roomId: message.roomId,
    parentMessageId: message.parentMessageId,
    content: message.content,
    createdAt: toDate(message.createdAt),
    deletedAt: toNullableDate(message.deletedAt),
    editedAt: toNullableDate(message.editedAt),
    sender: message.sender as ChatRoomMessage["sender"],
    mentions: message.mentions as ChatRoomMessage["mentions"],
    reactions: message.reactions as ChatRoomMessage["reactions"],
    threadReplyCount: message.threadReplyCount,
    threadLastReplyAt: toNullableDate(message.threadLastReplyAt),
    metadata: message.metadata,
    quote: message.quote as ChatRoomMessage["quote"],
  };
}
