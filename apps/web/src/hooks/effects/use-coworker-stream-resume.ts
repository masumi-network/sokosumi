"use client";

import { useEffect } from "react";

/**
 * Reconnects `useCoworkerDirectRoomStream` to Core's active stream when
 * entering a coworker room, and stops the active stream on room switch,
 * unmount, or Activity hide.
 */
export function useCoworkerStreamResume(
  roomId: string | null,
  resumeStream: () => Promise<void>,
  stop: () => Promise<void>,
): void {
  useEffect(() => {
    if (!roomId) {
      return;
    }
    void resumeStream();
    return () => {
      void stop();
    };
  }, [roomId, resumeStream, stop]);
}
