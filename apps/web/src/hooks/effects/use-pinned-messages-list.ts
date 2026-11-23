"use client";

import type { ChatRoomPinnedMessageListItem } from "@sokosumi/core-client";
import { useEffect, useState } from "react";
import { listPinnedMessagesAction } from "@/app/chat/actions";

/**
 * Loads the initial page of pinned messages for `PinnedMessagesPanel` whenever
 * `roomId`, `listGeneration`, or `labels.error` changes, ignoring stale
 * responses on cleanup.
 */
export function usePinnedMessagesList(
  roomId: string,
  listGeneration: number,
  labels: { error: string },
) {
  const [loadedItems, setItems] = useState<ChatRoomPinnedMessageListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setNextCursor(null);
    void listPinnedMessagesAction(roomId)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setError(labels.error);
          setItems([]);
          setIsLoading(false);
          return;
        }
        setItems(result.value.items);
        setNextCursor(result.value.nextCursor);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setError(labels.error);
        setItems([]);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [labels.error, listGeneration, roomId]);

  return {
    loadedItems,
    setItems,
    nextCursor,
    setNextCursor,
    isLoading,
    error,
    setError,
  };
}
