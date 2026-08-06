import type { ChatRoomMessageFullEventData } from "@/lib/ably/schema";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

function toDate(value: string): Date {
  return new Date(value);
}

function toNullableDate(value: string | null): Date | null {
  return value == null ? null : new Date(value);
}

/**
 * Ably JSON carries ISO strings; Core client DTOs use Date for the same fields.
 * Only for full create/update/delete envelopes (SOK-737 patches merge in place).
 */
export function hydrateChatRoomMessageFromRealtime(
  message: ChatRoomMessageFullEventData["message"],
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
    membership: message.membership as ChatRoomMessage["membership"],
    unfurls: message.unfurls as ChatRoomMessage["unfurls"],
  };
}
