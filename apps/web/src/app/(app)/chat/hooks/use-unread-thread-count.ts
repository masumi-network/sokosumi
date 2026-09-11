"use client";

import { useEffect, useState } from "react";

import { countUnreadThreadsAction } from "@/app/chat/actions";

/** Burst window for re-counts. Short enough to read as immediate. */
const COUNT_DEBOUNCE_MS = 150;

/**
 * Unread threads in the visible room, for the header threads trigger.
 *
 * Uses Core's cheap count path, so the trigger costs a number rather than a
 * page of thread items the closed panel would throw away.
 *
 * `refreshKey` is any string the caller changes when thread read state moves:
 * a reply arriving over realtime, a thread Look, Mark all, or the panel
 * closing. A failed count keeps the last number rather than blanking the
 * chrome, because this is a decoration and an error banner would outweigh it.
 *
 * Reads are coalesced behind a short delay. A busy room can fire the key
 * several times in a second (a burst of replies, a close that follows a Look),
 * and only the last of those answers is wanted.
 */
export function useUnreadThreadCount(
  roomId: string | null,
  refreshKey: string,
): number {
  const [counted, setCounted] = useState<{
    roomId: string;
    count: number;
  } | null>(null);

  useEffect(() => {
    if (!roomId) {
      return;
    }
    let active = true;
    const timeoutId = window.setTimeout(() => {
      void countUnreadThreadsAction(roomId).then((result) => {
        if (active && result.ok) {
          setCounted({ roomId, count: result.value });
        }
      });
    }, COUNT_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [roomId, refreshKey]);

  // A count belongs to the room it was fetched for, so switching rooms shows
  // zero until that room's own count lands.
  return counted?.roomId === roomId ? counted.count : 0;
}
