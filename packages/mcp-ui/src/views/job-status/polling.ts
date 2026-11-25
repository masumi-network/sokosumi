import { useEffect, useRef, useState } from "react";

/** The waits between checks: 3s, then 5s, then every 10s. */
export const POLL_DELAYS_MS = [3000, 5000, 10000] as const;

const delayAt = (attempt: number) =>
  POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)];

const hidden = () => document.visibilityState === "hidden";

/**
 * Calls `refresh` while `active` and the view is visible, backing off from
 * 3s to 10s. MCP Apps has no visibility signal of its own; a host's hidden
 * tab or collapsed view shows up as `document.visibilityState`. Hidden, it
 * waits; shown again, it checks after 3s, or 5s after a check that was still
 * running. `failed` is whether the last check failed; the next one still runs.
 */
export function usePolling(
  refresh: (() => Promise<boolean>) | undefined,
  active: boolean,
): { failed: boolean } {
  const [failed, setFailed] = useState(false);
  // The shell passes a new function each render; the loop must not restart.
  const latest = useRef(refresh);
  latest.current = refresh;
  const canRefresh = refresh !== undefined;

  useEffect(() => {
    if (!canRefresh || !active) return;
    let stopped = false;
    let checking = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      timer = undefined;
      checking = true;
      let ok = false;
      try {
        ok = (await latest.current?.()) ?? false;
      } catch {
        // A rejected check is a failed one; the loop goes on.
      } finally {
        checking = false;
      }
      if (stopped) return;
      setFailed(!ok);
      attempt += 1;
      schedule();
    };
    const schedule = () => {
      if (stopped || hidden() || timer || checking) return;
      timer = setTimeout(check, delayAt(attempt));
    };
    const onVisibilityChange = () => {
      if (hidden()) {
        clearTimeout(timer);
        timer = undefined;
      } else {
        attempt = 0;
        schedule();
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [canRefresh, active]);

  return { failed };
}
