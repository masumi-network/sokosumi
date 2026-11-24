"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  type ChatRefreshScheduler,
  createChatRefreshScheduler,
} from "./chat-refresh-scheduler";

interface UseChatRefreshSchedulerOptions {
  /** Identity of the data set; a new key restarts, null disables. */
  key: string | null;
  refresh: (isCurrent: () => boolean) => Promise<void>;
  /** Realtime is delivering for this data set; picks the recovery cadence. */
  healthy: boolean;
  /**
   * Poll cadence while unhealthy (the pre-SOK-986 interval). Left out, the data
   * set has no timer at all and reads only when asked: on mount, on recovery,
   * on `requestRefresh`.
   */
  fallbackIntervalMs?: number;
  /**
   * Read at once on mount and on key change, not only after an interval.
   * This read runs in the background too, like an explicit request.
   */
  refreshOnMount?: boolean;
  /**
   * Read once when `healthy` flips back on. For consumers with no
   * continuity signal of their own (the sidebar collections); the open room
   * gets that from its channel instead.
   */
  refreshOnRecovery?: boolean;
  /**
   * Read each time the window returns to the foreground, stale or not. For a
   * data set another tab or device can change with no event to say so.
   */
  refreshOnForeground?: boolean;
}

/**
 * React wrapper around `createChatRefreshScheduler` (SOK-986).
 *
 * Returns a stable `requestRefresh` for callers that learned something
 * changed (id envelope, lost continuity, collection invalidation).
 */
export function useChatRefreshScheduler({
  key,
  refresh,
  healthy,
  fallbackIntervalMs,
  refreshOnMount = false,
  refreshOnRecovery = false,
  refreshOnForeground = false,
}: UseChatRefreshSchedulerOptions): () => void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const healthyRef = useRef(healthy);
  healthyRef.current = healthy;
  const schedulerRef = useRef<ChatRefreshScheduler | null>(null);
  schedulerRef.current ??= createChatRefreshScheduler({
    refresh: (isCurrent) => refreshRef.current(isCurrent),
    healthy,
    getHealthy: () => healthyRef.current,
    fallbackIntervalMs,
    refreshOnMount,
    refreshOnRecovery,
    refreshOnForeground,
  });

  useEffect(() => {
    if (!key) {
      return;
    }
    const scheduler = schedulerRef.current;
    scheduler?.start({
      fallbackIntervalMs,
      refreshOnMount,
      refreshOnForeground,
    });
    return () => {
      scheduler?.stop();
    };
  }, [key, fallbackIntervalMs, refreshOnMount, refreshOnForeground]);

  useEffect(() => {
    schedulerRef.current?.setHealth(healthy, refreshOnRecovery);
  }, [healthy, refreshOnRecovery]);

  return useCallback(() => {
    schedulerRef.current?.request();
  }, []);
}
