"use client";

import { useEffect } from "react";

/**
 * Reconnects `useCoworkerDirectRoomStream` to Core's active stream when
 * entering a coworker room, and clears the overlay when leaving (`roomId` is
 * `null`).
 */
export function useCoworkerStreamResume(
  roomId: string | null,
  resumeStream: () => Promise<void>,
  clearOverlay: () => void,
): void {
  useEffect(() => {
    if (!roomId) {
      clearOverlay();
      return;
    }
    void resumeStream();
  }, [roomId, resumeStream, clearOverlay]);
}
