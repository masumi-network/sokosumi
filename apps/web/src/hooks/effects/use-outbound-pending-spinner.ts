"use client";

import { useEffect, useState } from "react";
import {
  OUTBOUND_PENDING_SPINNER_DELAY_MS,
  type OutboundDeliveryStatus,
  outboundPendingAgeMs,
  shouldShowOutboundPendingSpinner,
} from "@/app/chat/utils/outbound-room-message";

/**
 * Delays showing the pending outbound delivery spinner until the optimistic
 * message has been in flight past `OUTBOUND_PENDING_SPINNER_DELAY_MS`.
 */
export function useOutboundPendingSpinner(
  outboundStatus: OutboundDeliveryStatus | null,
  createdAt: Date | string,
): boolean {
  const [showPendingSpinner, setShowPendingSpinner] = useState(() =>
    outboundStatus === "pending"
      ? shouldShowOutboundPendingSpinner(createdAt)
      : false,
  );

  useEffect(() => {
    if (outboundStatus !== "pending") {
      setShowPendingSpinner(false);
      return;
    }
    if (shouldShowOutboundPendingSpinner(createdAt)) {
      setShowPendingSpinner(true);
      return;
    }
    setShowPendingSpinner(false);
    const remainingMs =
      OUTBOUND_PENDING_SPINNER_DELAY_MS - outboundPendingAgeMs(createdAt);
    const timeoutId = window.setTimeout(
      () => {
        setShowPendingSpinner(true);
      },
      Math.max(0, remainingMs),
    );
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [outboundStatus, createdAt]);

  return showPendingSpinner;
}
