"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useEffect } from "react";
import { rememberPinnedRooms } from "@/components/chat/remembered-pinned-rooms";

/**
 * Persists the sidebar's current Pinned list in session memory so a workspace
 * switch holds those rows until the next workspace read lands.
 */
export function useRememberPinnedRooms(
  currentUserId: string,
  pinned: readonly ChatRoom[],
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    rememberPinnedRooms(currentUserId, pinned);
  }, [currentUserId, enabled, pinned]);
}
