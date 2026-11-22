"use client";

import { useEffect, useState } from "react";
import { MOBILE_BREAKPOINT } from "@/hooks/effects/use-mobile";

/** How long a desktop page waits for its sidebar to take over the reads. */
export const SIDEBAR_REGISTRATION_WAIT_MS = 2_000;

/**
 * Waits briefly on desktop viewports so the chat sidebar can register as the
 * active membership-visible rooms reader before `useLiveChatRoomsRead` starts
 * its own reader; settles immediately on mobile viewports.
 */
export function useLiveChatRoomsOwnershipSettled(): boolean {
  const [ownershipSettled, setOwnershipSettled] = useState(false);

  useEffect(() => {
    if (window.innerWidth < MOBILE_BREAKPOINT) {
      setOwnershipSettled(true);
      return;
    }
    const timer = window.setTimeout(
      () => setOwnershipSettled(true),
      SIDEBAR_REGISTRATION_WAIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);

  return ownershipSettled;
}
