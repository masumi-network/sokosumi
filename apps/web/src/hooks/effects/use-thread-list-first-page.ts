"use client";

import type { ChatRoomThread } from "@sokosumi/core-client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { listThreadsAction } from "@/app/chat/actions";

/**
 * Loads the first page of threads for `ThreadListPanel` whenever `roomId`
 * changes, invalidating in-flight requests on cleanup and exposing
 * `loadFirstPage` for reloads after Mark all as read.
 */
export function useThreadListFirstPage(
  roomId: string,
  labels: { error: string },
) {
  const [items, setItems] = useState<ChatRoomThread[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [olderFailed, setOlderFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const listRequestIdRef = useRef(0);

  const loadFirstPage = useEffectEvent(async () => {
    const requestId = ++listRequestIdRef.current;
    setIsLoading(true);
    setError(null);
    setOlderFailed(false);
    try {
      const result = await listThreadsAction(roomId);
      if (requestId !== listRequestIdRef.current) {
        return;
      }
      if (!result.ok) {
        setItems([]);
        setNextCursor(null);
        setError(result.error.message || labels.error);
        return;
      }
      setItems(result.value.threads);
      setNextCursor(result.value.nextCursor);
    } catch {
      if (requestId !== listRequestIdRef.current) {
        return;
      }
      setItems([]);
      setNextCursor(null);
      setError(labels.error);
    } finally {
      if (requestId === listRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  });

  useEffect(() => {
    void loadFirstPage();
    return () => {
      listRequestIdRef.current += 1;
    };
  }, [roomId]);

  return {
    items,
    setItems,
    nextCursor,
    setNextCursor,
    error,
    setError,
    olderFailed,
    setOlderFailed,
    isLoading,
    listRequestIdRef,
    loadFirstPage,
  };
}
