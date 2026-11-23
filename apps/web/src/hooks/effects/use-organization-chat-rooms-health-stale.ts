"use client";

import { type RefObject, useEffect } from "react";

/**
 * Marks the active chat rooms list stale whenever Ably connection health flips
 * so the next read fetches the whole list in case an event was missed.
 */
export function useOrganizationChatRoomsHealthStale(
  staleActiveRef: RefObject<{ wholeList: boolean }>,
  healthy: boolean,
): void {
  // `healthy` is the trigger: either flip can have lost an event.
  useEffect(() => {
    staleActiveRef.current.wholeList = true;
  }, [healthy]);
}
