"use client";

import { useEffect, useEffectEvent } from "react";

import type { PendingRoomQuote } from "@/app/chat/components/room-helpers";
import { takePrivateReply } from "@/app/chat/utils/private-reply-handoff";

/** Gives the open room the quote a Reply privately left for it, once. */
export function usePrivateReplyHandoff(
  roomId: string | null,
  onQuote: (quote: PendingRoomQuote) => void,
): void {
  const handOver = useEffectEvent(onQuote);
  useEffect(() => {
    if (!roomId) return;
    const quote = takePrivateReply(roomId);
    if (quote) handOver(quote);
  }, [roomId]);
}
