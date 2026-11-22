"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Pins the live edge of `RoomsClient` in the layout phase when history finishes
 * loading (`messagesPending` flips `true -> false`) unless opening at unread.
 */
export function useRoomsClientScrollOnHistoryLoaded(
  messagesPending: boolean,
  opensAtUnread: boolean,
  scrollToBottom: () => void,
): void {
  const wasHistoryPendingRef = useRef(messagesPending);
  useLayoutEffect(() => {
    const wasPending = wasHistoryPendingRef.current;
    wasHistoryPendingRef.current = messagesPending;
    if (!wasPending || messagesPending || opensAtUnread) {
      return;
    }
    scrollToBottom();
  }, [messagesPending, opensAtUnread, scrollToBottom]);
}
