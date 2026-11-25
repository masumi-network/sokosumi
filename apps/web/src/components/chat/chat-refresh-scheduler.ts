import { chatReadThrottleResumeInMs } from "@/lib/chat/chat-read-throttle";

/** Recovery read cadence while Ably is healthy (SOK-986 starting policy). */
export const CHAT_HEALTHY_REFRESH_MS = 60_000;

/** Foreground means the document is visible and its window has focus. */
function isChatForeground(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

export interface ChatRefreshSchedulerStartOptions {
  /**
   * Poll cadence while unhealthy (the pre-SOK-986 interval). Left out, the data
   * set has no timer at all and reads only when asked: on mount, on recovery,
   * on `request`.
   */
  fallbackIntervalMs?: number;
  /**
   * Read at once on start, not only after an interval.
   * This read runs in the background too, like an explicit request.
   */
  refreshOnMount?: boolean;
  /**
   * Read each time the window returns to the foreground, stale or not. For a
   * data set another tab or device can change with no event to say so.
   */
  refreshOnForeground?: boolean;
}

export interface ChatRefreshSchedulerOptions
  extends ChatRefreshSchedulerStartOptions {
  refresh: (isCurrent: () => boolean) => Promise<void>;
  /** Realtime is delivering for this data set; picks the recovery cadence. */
  healthy: boolean;
  /**
   * Optional live health reader consulted when arming the timer (e.g. a React
   * ref written during render). Falls back to the latest `setHealth` value.
   */
  getHealthy?: () => boolean;
  /**
   * Read once when `healthy` flips back on. For consumers with no
   * continuity signal of their own (the sidebar collections); the open room
   * gets that from its channel instead.
   */
  refreshOnRecovery?: boolean;
}

export interface ChatRefreshScheduler {
  start: (overrides?: ChatRefreshSchedulerStartOptions) => void;
  stop: () => void;
  request: () => void;
  setHealth: (healthy: boolean, refreshOnRecovery?: boolean) => void;
}

const noop = () => {};

/**
 * Schedules one chat data set's automatic HTTP reads (SOK-986).
 *
 * Owns foreground tracking, coalescing, in-flight de-duplication, deferred
 * needs, and the recovery timer for one data set: room messages, one sidebar
 * collection, or the mobile unread indicator. Ably events apply to local
 * state elsewhere; this only decides when a read may start.
 *
 * - Background (hidden or unfocused): no timer read starts. An elapsed timer
 *   is recorded as a need, and one read runs on return to the foreground; a
 *   return with nothing stale keeps the running timer.
 * - Explicit requests read at once, background or not. They carry a change
 *   the reader must be shown while away, such as a foreign-room message that
 *   becomes the tab title's unread count; deferring them to the return would
 *   show the count only when it is no longer needed.
 * - In flight: any need that arrives queues exactly one follow-up read,
 *   never a parallel one. A queued explicit request stays explicit.
 * - Timer: re-armed after completion, so a slow response never stacks; the
 *   interval is 60 seconds while healthy, `fallbackIntervalMs` otherwise.
 * - Throttled (SOK-1065): no read starts while the shared per-user throttle
 *   clock is in the future. A read that would start inside the window is
 *   recorded as a need and runs once when the window ends. Explicit
 *   requests defer too — never bypassing the throttle — but keep their
 *   privilege and fire while backgrounded when the window ends.
 */
export function createChatRefreshScheduler({
  refresh,
  healthy: initialHealthy,
  getHealthy,
  fallbackIntervalMs: initialFallbackIntervalMs,
  refreshOnMount: initialRefreshOnMount = false,
  refreshOnRecovery: initialRefreshOnRecovery = false,
  refreshOnForeground: initialRefreshOnForeground = false,
}: ChatRefreshSchedulerOptions): ChatRefreshScheduler {
  let currentHealthy = initialHealthy;
  // A health flip re-arms the pending timer with the new cadence. A
  // recovery read is only for a drop after this instance has already
  // been healthy — the first connect is not a gap (SOK-986).
  let wasHealthy = initialHealthy;
  let hadHealthy = initialHealthy;
  let requestCurrent: () => void = noop;
  let rescheduleCurrent: () => void = noop;
  let stopCurrent: (() => void) | null = null;

  function readHealthy(): boolean {
    return getHealthy ? getHealthy() : currentHealthy;
  }

  function stop(): void {
    const cleanup = stopCurrent;
    stopCurrent = null;
    cleanup?.();
  }

  function start(overrides?: ChatRefreshSchedulerStartOptions): void {
    stop();

    const fallbackIntervalMs =
      overrides && "fallbackIntervalMs" in overrides
        ? overrides.fallbackIntervalMs
        : initialFallbackIntervalMs;
    const refreshOnMount = overrides?.refreshOnMount ?? initialRefreshOnMount;
    const refreshOnForeground =
      overrides?.refreshOnForeground ?? initialRefreshOnForeground;

    let cancelled = false;
    let inFlight = false;
    let queued = false;
    let queuedExplicit = false;
    let needed = false;
    let wasForeground = isChatForeground();
    let timer: number | undefined;
    let throttleTimer: number | undefined;
    let throttleExplicit = false;

    function schedule() {
      window.clearTimeout(timer);
      if (cancelled || fallbackIntervalMs === undefined) return;
      timer = window.setTimeout(
        onTimer,
        readHealthy() ? CHAT_HEALTHY_REFRESH_MS : fallbackIntervalMs,
      );
    }

    function onTimer() {
      void run();
    }

    function onThrottleEnd() {
      throttleTimer = undefined;
      const fireExplicit = throttleExplicit;
      throttleExplicit = false;
      // The clock is re-consulted inside `run`, so a throttle that extended
      // the window past this timer simply defers again.
      void run(fireExplicit);
    }

    async function run(explicit = false) {
      if (cancelled) return;
      // Any read that would start inside the throttle window becomes one
      // coalesced catch-up read at the window's end instead of a
      // guaranteed-429 request. At most one resume timer runs per reader.
      const resumeInMs = chatReadThrottleResumeInMs();
      if (resumeInMs > 0) {
        if (explicit) {
          throttleExplicit = true;
        } else {
          needed = true;
        }
        throttleTimer ??= window.setTimeout(onThrottleEnd, resumeInMs);
        return;
      }
      if (!explicit && !isChatForeground()) {
        needed = true;
        return;
      }
      if (inFlight) {
        queued = true;
        queuedExplicit ||= explicit;
        return;
      }
      window.clearTimeout(timer);
      // Jittered resume timer can outlive the clock; this start consumes it.
      window.clearTimeout(throttleTimer);
      throttleTimer = undefined;
      throttleExplicit = false;
      inFlight = true;
      needed = false;
      try {
        await refresh(() => !cancelled);
      } catch {
        // Keep the current data; the next interval retries.
      } finally {
        inFlight = false;
        if (!cancelled) {
          if (queued) {
            const followUpExplicit = queuedExplicit;
            queued = false;
            queuedExplicit = false;
            void run(followUpExplicit);
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
      if (!needed && !refreshOnForeground) return;
      needed = false;
      void run();
    }

    const onOnline = () => void run();

    requestCurrent = () => void run(true);
    rescheduleCurrent = () => {
      if (!inFlight) schedule();
    };

    window.addEventListener("focus", onForegroundChange);
    window.addEventListener("blur", onForegroundChange);
    document.addEventListener("visibilitychange", onForegroundChange);
    window.addEventListener("online", onOnline);

    stopCurrent = () => {
      cancelled = true;
      queued = false;
      queuedExplicit = false;
      window.clearTimeout(timer);
      window.clearTimeout(throttleTimer);
      window.removeEventListener("focus", onForegroundChange);
      window.removeEventListener("blur", onForegroundChange);
      document.removeEventListener("visibilitychange", onForegroundChange);
      window.removeEventListener("online", onOnline);
      requestCurrent = noop;
      rescheduleCurrent = noop;
    };

    // The first read is what the page shows, not background upkeep: it must
    // not wait for focus. Typing the URL leaves focus in the address bar, and
    // a room opened in a background tab would otherwise sit on skeletons.
    if (refreshOnMount) {
      void run(true);
    } else {
      schedule();
    }
  }

  function setHealth(
    healthy: boolean,
    refreshOnRecovery = initialRefreshOnRecovery,
  ): void {
    currentHealthy = healthy;
    rescheduleCurrent();
    if (refreshOnRecovery && healthy && hadHealthy && !wasHealthy) {
      requestCurrent();
    }
    if (healthy) {
      hadHealthy = true;
    }
    wasHealthy = healthy;
  }

  return {
    start,
    stop,
    request: () => requestCurrent(),
    setHealth,
  };
}
