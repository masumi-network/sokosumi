"use client";

import { useEffect, useState } from "react";
import { OUTBOUND_SENT_TICK_MS } from "@/app/chat/utils/outbound-room-message";

/**
 * Starts fading the outbound "sent" checkmark halfway through
 * `OUTBOUND_SENT_TICK_MS` while `showSentTick` is active.
 */
export function useOutboundSentTickFade(
  showSentTick: boolean,
  createdAt: Date | string,
): boolean {
  const [sentFading, setSentFading] = useState(false);

  useEffect(() => {
    if (!showSentTick) {
      setSentFading(false);
      return;
    }
    setSentFading(false);
    const fadeAt = window.setTimeout(() => {
      setSentFading(true);
    }, OUTBOUND_SENT_TICK_MS / 2);
    return () => {
      window.clearTimeout(fadeAt);
    };
  }, [showSentTick, createdAt]);

  return sentFading;
}
