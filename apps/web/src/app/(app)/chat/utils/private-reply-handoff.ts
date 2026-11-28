import type { ChatRoomMessage } from "@sokosumi/core-client";

import {
  type PendingRoomQuote,
  pendingQuoteFromMessage,
} from "@/app/chat/components/room-helpers";

/** Asks the Direct a Reply privately opens for the quote it carries. */
export const CHAT_PRIVATE_REPLY_PARAM = "reply";

/**
 * Reply privately quotes a Channel message in its author's Direct. The room
 * view remounts while the Direct opens, so the quote waits here, outside
 * React, under a nonce that only the navigation it starts carries. A
 * navigation that is canceled or superseded never arrives with the nonce, so
 * its quote is never applied; the next Reply privately replaces it.
 */
let handoff: { nonce: string; quote: PendingRoomQuote } | null = null;

/** Keeps the message's quote for this navigation and returns its href. */
export function handOffPrivateReply(
  directHref: string,
  message: ChatRoomMessage,
): string {
  const nonce = crypto.randomUUID();
  handoff = {
    nonce,
    quote: { ...pendingQuoteFromMessage(message), roomId: message.roomId },
  };
  return `${directHref}?${CHAT_PRIVATE_REPLY_PARAM}=${nonce}`;
}

/** The quote the arriving navigation asked for, once. */
export function takePrivateReply(
  nonce: string | null,
): PendingRoomQuote | null {
  if (!nonce || handoff?.nonce !== nonce) {
    return null;
  }
  const { quote } = handoff;
  handoff = null;
  return quote;
}
