import type { ChatRoomMessage } from "@sokosumi/core-client";

import {
  type PendingRoomQuote,
  pendingQuoteFromMessage,
} from "@/app/chat/components/room-helpers";

/**
 * Reply privately quotes a Channel message in its author's Direct. The room
 * view can unmount while the Direct opens, so the quote waits here, outside
 * React, until that Direct's view takes it.
 */
let handoff: { roomId: string; quote: PendingRoomQuote } | null = null;

export function handOffPrivateReply(
  directRoomId: string,
  message: ChatRoomMessage,
): void {
  handoff = {
    roomId: directRoomId,
    quote: { ...pendingQuoteFromMessage(message), roomId: message.roomId },
  };
}

export function takePrivateReply(roomId: string): PendingRoomQuote | null {
  if (handoff?.roomId !== roomId) {
    return null;
  }
  const { quote } = handoff;
  handoff = null;
  return quote;
}
