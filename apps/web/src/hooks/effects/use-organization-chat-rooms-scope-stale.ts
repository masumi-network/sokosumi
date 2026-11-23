"use client";

import { type RefObject, useEffect } from "react";

export interface OrganizationChatRoomsStaleActive {
  rooms: Set<string>;
  wholeList: boolean;
}

/**
 * Resets single-room stale tracking whenever the sidebar scope changes and
 * marks the active collection stale whenever the browser comes back online so
 * the next read fetches the whole list in case an event was missed.
 */
export function useOrganizationChatRoomsScopeStale(
  staleActiveRef: RefObject<OrganizationChatRoomsStaleActive>,
  scope: string | null,
): void {
  // `scope` is the trigger: a new one starts with nothing known.
  useEffect(() => {
    staleActiveRef.current = { rooms: new Set(), wholeList: true };
    const onOnline = () => {
      staleActiveRef.current.wholeList = true;
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [scope, staleActiveRef]);
}
