"use client";

import type { UIMessage } from "ai";
import { useEffect } from "react";

/**
 * Drops the stream overlay when leaving a coworker stream room and reconnects
 * to Core's active stream when entering or switching rooms.
 */
export function useCoworkerStreamRoomReconnect(
  roomId: string | null,
  resumeStream: () => Promise<void>,
  setMessages: (messages: UIMessage[]) => void,
): void {
  // Leave: drop overlay. Enter: reconnect to Core active stream (Thinking…).
  useEffect(() => {
    if (!roomId) {
      setMessages([]);
      return;
    }
    void resumeStream();
  }, [roomId, resumeStream, setMessages]);
}
