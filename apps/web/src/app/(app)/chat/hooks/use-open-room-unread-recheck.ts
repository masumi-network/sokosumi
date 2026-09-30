"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useEffect } from "react";

/** Longer than a read-attention write takes to clear the count. */
export const OPEN_ROOM_UNREAD_RECHECK_MS = 4_000;

/**
 * Asks for one history read when the open room still counts unread messages
 * a few seconds after that count changed.
 *
 * Realtime can miss a message: an over-limit update arrives as an id envelope
 * whose refresh the read throttle defers, or a reattach drops an event. The
 * room list still counts that message as unread for the open room, and read
 * attention never clears it because the message never reaches the transcript.
 */
export function useOpenRoomUnreadRecheck(options: {
  room: ChatRoom | null;
  messagesPending: boolean;
  requestRefresh: () => void;
}): void {
  const { room, messagesPending, requestRefresh } = options;
  const unread = room?.channelUnreadCount ?? 0;
  const signal =
    room && !messagesPending && unread > 0
      ? `${room.id}:${unread}:${new Date(room.updatedAt).getTime()}`
      : null;

  useEffect(() => {
    if (!signal) return;
    const timer = window.setTimeout(
      requestRefresh,
      OPEN_ROOM_UNREAD_RECHECK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [signal, requestRefresh]);
}
