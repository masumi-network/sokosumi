"use client";

import { useCallback, useEffect, useRef } from "react";

/** Recovery read cadence while Ably is healthy (SOK-986 starting policy). */
export const CHAT_HEALTHY_REFRESH_MS = 60_000;

/** Foreground means the document is visible and its window has focus. */
function isChatForeground(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

interface UseChatRefreshSchedulerOptions {
  /** Identity of the data set; a new key restarts, null disables. */
  key: string | null;
  refresh: (isCurrent: () => boolean) => Promise<void>;
  /** Realtime is delivering for this data set; picks the recovery cadence. */
  healthy: boolean;
  /** Poll cadence while unhealthy (the pre-SOK-986 interval). */
  fallbackIntervalMs: number;
  /** Read at once on mount and on key change (sidebar), not only after an interval. */
  refreshOnMount?: boolean;
  /**
   * Read once when `healthy` flips back on. For consumers with no
   * continuity signal of their own (the sidebar collections); the open room
   * gets that from its channel instead.
   */
  refreshOnRecovery?: boolean;
}

/**
 * Schedules one chat data set's automatic HTTP reads (SOK-986).
 *
 * Owns foreground tracking, coalescing, in-flight de-duplication, deferred
 * needs, and the recovery timer for one data set: room messages, one sidebar
 * collection, or the mobile unread indicator. Ably events apply to local
 * state elsewhere; this only decides when a read may start.
 *
 * - Background (hidden or unfocused): no read starts. A request or an
 *   elapsed timer is recorded as a need, and one read runs on return to the
 *   foreground; a return with nothing stale keeps the running timer.
 * - In flight: any need that arrives queues exactly one follow-up read,
 *   never a parallel one.
 * - Timer: re-armed after completion, so a slow response never stacks; the
 *   interval is 60 seconds while healthy, `fallbackIntervalMs` otherwise.
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
}: UseChatRefreshSchedulerOptions): () => void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const healthyRef = useRef(healthy);
  healthyRef.current = healthy;
  const requestRef = useRef<() => void>(() => {});
  const rescheduleRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!key) {
      return;
    }
    let cancelled = false;
    let inFlight = false;
    let queued = false;
    let needed = false;
    let wasForeground = isChatForeground();
    let timer: number | undefined;

    function schedule() {
      window.clearTimeout(timer);
      if (cancelled) return;
      timer = window.setTimeout(
        onTimer,
        healthyRef.current ? CHAT_HEALTHY_REFRESH_MS : fallbackIntervalMs,
      );
    }

    function onTimer() {
      void run();
    }

    async function run() {
      if (cancelled) return;
      if (!isChatForeground()) {
        needed = true;
        return;
      }
      if (inFlight) {
        queued = true;
        return;
      }
      window.clearTimeout(timer);
      inFlight = true;
      try {
        await refreshRef.current(() => !cancelled);
      } catch {
        // Keep the current data; the next interval retries.
      } finally {
        inFlight = false;
        if (!cancelled) {
          if (queued) {
            queued = false;
            void run();
          } else {
            schedule();
          }
        }
      }
    }

    function onForegroundChange() {
      const foreground = isChatForeground();
      if (!foreground) {
        wasForeground = false;
        return;
      }
      if (wasForeground) return;
      wasForeground = true;
      // Focus and visibility arriving together collapse into this one
      // transition; only recorded staleness turns it into a read.
      if (!needed) return;
      needed = false;
      void run();
    }

    const onOnline = () => void run();

    requestRef.current = () => void run();
    rescheduleRef.current = () => {
      if (!inFlight) schedule();
    };

    window.addEventListener("focus", onForegroundChange);
    window.addEventListener("blur", onForegroundChange);
    document.addEventListener("visibilitychange", onForegroundChange);
    window.addEventListener("online", onOnline);

    if (refreshOnMount) {
      void run();
    } else {
      schedule();
    }

    return () => {
      cancelled = true;
      queued = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onForegroundChange);
      window.removeEventListener("blur", onForegroundChange);
      document.removeEventListener("visibilitychange", onForegroundChange);
      window.removeEventListener("online", onOnline);
      requestRef.current = () => {};
      rescheduleRef.current = () => {};
    };
  }, [key, fallbackIntervalMs, refreshOnMount]);

  // A health flip re-arms the pending timer with the new cadence. A
  // recovery read is only for a drop after this instance has already
  // been healthy — the first connect is not a gap (SOK-986).
  const wasHealthyRef = useRef(healthy);
  const hadHealthyRef = useRef(healthy);
  useEffect(() => {
    rescheduleRef.current();
    if (
      refreshOnRecovery &&
      healthy &&
      hadHealthyRef.current &&
      !wasHealthyRef.current
    ) {
      requestRef.current();
    }
    if (healthy) {
      hadHealthyRef.current = true;
    }
    wasHealthyRef.current = healthy;
  }, [healthy, refreshOnRecovery]);

  return useCallback(() => requestRef.current(), []);
}
