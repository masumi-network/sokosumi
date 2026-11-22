"use client";

import type { ChatRoomMessage } from "@sokosumi/core-client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { coreClient } from "@/lib/clients/core.browser.client";

const SEARCH_PAGE_SIZE = 50;

/**
 * Runs debounced room message search requests while `RoomSearchPanel` is open,
 * tracking request revisions so out-of-order or closed-panel responses are
 * dropped.
 */
export function useRoomSearchQuery(
  roomId: string,
  open: boolean,
  debouncedQuery: string,
  labels: { error: string },
) {
  const [results, setResults] = useState<ChatRoomMessage[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const searchMessages = useEffectEvent(async (searchQuery: string) => {
    const requestId = ++requestIdRef.current;
    if (!searchQuery) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await coreClient.getChatRoomMessages(roomId, {
        q: searchQuery,
        limit: SEARCH_PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) {
        return;
      }
      setResults(response.data);
      setActiveIndex(0);
    } catch {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setResults([]);
      setError(labels.error);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    void searchMessages(debouncedQuery);
  }, [debouncedQuery, open, roomId]);

  function resetSearch(nextLoading: boolean) {
    setResults([]);
    setActiveIndex(0);
    setError(null);
    setIsLoading(nextLoading);
    requestIdRef.current += 1;
  }

  return {
    results,
    activeIndex,
    setActiveIndex,
    error,
    isLoading,
    resetSearch,
  };
}
