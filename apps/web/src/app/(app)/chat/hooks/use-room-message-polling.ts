"use client";

import { useCallback, useEffect, useRef } from "react";

const ROOM_MESSAGE_POLL_MS = 3_000;

/** Coalesce refresh triggers and schedule the next poll after completion. */
export function useRoomMessagePolling(
  roomId: string | null | undefined,
  refresh: (isCurrent: () => boolean) => Promise<void>,
): () => Promise<void> {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const refreshNowRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let inFlight = false;
    let timer: number | undefined;

    function schedule() {
      if (cancelled || document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => void refreshNow(), ROOM_MESSAGE_POLL_MS);
    }

    async function refreshNow() {
      if (cancelled || inFlight || document.visibilityState !== "visible")
        return;
      window.clearTimeout(timer);
      inFlight = true;
      try {
        await refreshRef.current(() => !cancelled);
      } catch {
        // Keep existing messages and retry after the normal delay.
      } finally {
        inFlight = false;
        schedule();
      }
    }

    const onFocus = () => void refreshNow();
    const onVisibilityChange = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") void refreshNow();
    };
    refreshNowRef.current = refreshNow;
    schedule();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (refreshNowRef.current === refreshNow) {
        refreshNowRef.current = async () => {};
      }
    };
  }, [roomId]);

  return useCallback(() => refreshNowRef.current(), []);
}
