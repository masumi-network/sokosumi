import type { ChatRoomMessageIdEnvelopeData } from "@/lib/ably/schema";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

export type ChatRoomMessageIdEnvelopeAction =
  | { kind: "ignore" }
  | { kind: "refresh" }
  | {
      kind: "tombstone";
      messageId: string;
      parentMessageId: string | null;
    };

/**
 * Decide how a focused-room client applies an over-limit Ably id envelope
 * (ADR 0014). Create/update never invent a row; delete tombstones by id
 * because list GET omits deleted messages.
 */
export function chatRoomMessageIdEnvelopeAction(
  event: ChatRoomMessageIdEnvelopeData,
  selectedRoomId: string | null,
): ChatRoomMessageIdEnvelopeAction {
  if (event.roomId !== selectedRoomId) {
    return { kind: "ignore" };
  }
  if (event.eventType === "delete") {
    return {
      kind: "tombstone",
      messageId: event.messageId,
      parentMessageId: event.parentMessageId,
    };
  }
  return { kind: "refresh" };
}

/** In-place tombstone matching Core's mapped delete DTO. */
export function tombstoneChatRoomMessage(
  existing: ChatRoomMessage,
): ChatRoomMessage {
  return {
    ...existing,
    content: "",
    deletedAt: existing.deletedAt ?? new Date(),
    editedAt: null,
    mentions: [],
    reactions: [],
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
  };
}
