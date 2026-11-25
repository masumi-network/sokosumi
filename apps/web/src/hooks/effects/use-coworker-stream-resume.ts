"use client";

import { useEffect } from "react";

/**
 * Reconnects `useCoworkerDirectRoomStream` to Core's active stream when
 * entering a coworker room (`roomId` becomes non-null or changes).
 */
export function useCoworkerStreamResume(
  roomId: string | null,
  resumeStream: () => Promise<void>,
): void {
  useEffect(() => {
    if (!roomId) {
      return;
    }
    void resumeStream();
  }, [roomId, resumeStream]);
}
