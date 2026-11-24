"use client";

import { useCallback, useEffect, useRef } from "react";
import { useDebouncedCallback } from "use-debounce";
import {
  TASKS_BOARD_REFRESH_DEBOUNCE_MS,
  TASKS_BOARD_REFRESH_MAX_WAIT_MS,
} from "@/app/tasks/constants";
import { subscribeTaskArchiveSettled } from "@/app/tasks/utils/archived-task-ids";
import { hasPendingArrivalRefresh } from "./use-refresh-prefetched-page";

/**
 * A debounced refresh for realtime events. A tab in the background does not
 * refresh for every event: it notes that something changed and refreshes
 * once when it is shown again.
 */
export function useRefreshWhenShown(refresh: () => void): () => void {
  const debounced = useDebouncedCallback(
    refresh,
    TASKS_BOARD_REFRESH_DEBOUNCE_MS,
    { maxWait: TASKS_BOARD_REFRESH_MAX_WAIT_MS },
  );
  const changedWhileHiddenRef = useRef(false);

  const scheduleRefresh = useCallback(() => {
    if (document.visibilityState === "hidden") {
      changedWhileHiddenRef.current = true;
      return;
    }
    debounced();
  }, [debounced]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState !== "visible" ||
        !changedWhileHiddenRef.current
      )
        return;
      changedWhileHiddenRef.current = false;
      debounced();
    };
    const unsubscribeArchiveSettled = subscribeTaskArchiveSettled(() => {
      if (hasPendingArrivalRefresh(window.location.pathname)) return;
      scheduleRefresh();
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      unsubscribeArchiveSettled();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      debounced.cancel();
    };
  }, [debounced, scheduleRefresh]);

  return scheduleRefresh;
}
