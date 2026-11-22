"use client";

import { type RefObject, useEffect } from "react";

/**
 * Clears cached coworker stream overlay timestamps whenever direct-room
 * streaming is disabled.
 */
export function useCoworkerStreamOverlayClearOnDisable(
  enabled: boolean,
  overlayCreatedAtByMessageIdRef: RefObject<Map<string, number>>,
): void {
  useEffect(() => {
    if (!enabled) {
      overlayCreatedAtByMessageIdRef.current.clear();
    }
  }, [enabled]);
}
