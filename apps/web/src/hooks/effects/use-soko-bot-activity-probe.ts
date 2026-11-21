"use client";

import { useEffect, useRef } from "react";

/**
 * How often the cheap probe runs. Turns are short — five to twenty seconds —
 * and this surface watches ones it did not start, so anything slower means a
 * turn begins and ends between two ticks and is only ever seen finished.
 */
const PROBE_MS = 2_500;
/** Short, because another probe follows in 2.5 seconds anyway. */
const PROBE_TIMEOUT_MS = 8_000;

interface Activity {
  status: string;
  activeTurnId: string | null;
  lastTurnAt: string | null;
}

/** Everything that means "go and refetch": who is running, and what changed. */
function activitySignature(activity: Activity): string {
  return `${activity.status}:${activity.activeTurnId ?? ""}:${activity.lastTurnAt ?? ""}`;
}

/**
 * Polls `activityEndpoint` on mount, on a 2.5 s interval, and on tab
 * visibility return, invoking `onActivityChanged` whenever the bot's activity
 * signature moves or a turn is in flight.
 */
export function useSokoBotActivityProbe(
  activityEndpoint: string,
  onActivityChanged: () => Promise<void>,
): void {
  const lastSignature = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let probing = false;

    /**
     * Reads the probe. Bounded and one at a time, so a stalled proxy cannot
     * stack a request every 2.5 seconds or let answers arrive out of order.
     *
     * Scoped to the probe alone: holding this across the state read would
     * block every later probe for as long as that read takes, which is the
     * starvation this whole change exists to remove.
     */
    async function probe(): Promise<Activity | null> {
      if (probing) return null;
      probing = true;
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(activityEndpoint, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { activity?: Activity | null };
        return body.activity ?? null;
      } catch {
        // Offline, aborted or timed out: the next tick retries.
        return null;
      } finally {
        clearTimeout(deadline);
        probing = false;
      }
    }

    async function tick() {
      if (document.visibilityState !== "visible" || stopped) return;
      const activity = await probe();
      if (!activity || stopped) return;
      const signature = activitySignature(activity);
      // Refetch while a turn is running, so its steps keep arriving, and
      // once more on the tick where it settles.
      const changed = signature !== lastSignature.current;
      if (changed || activity.activeTurnId !== null) {
        await onActivityChanged();
        // Recorded only once the read has been made, so a signature is never
        // marked seen on behalf of a fetch that did not happen.
        lastSignature.current = signature;
      }
    }

    // Probe once on mount, not only after the first interval: a turn can start
    // between the server render and hydration, and waiting a full interval to
    // ask would miss a short one entirely.
    void tick();
    const interval = setInterval(() => void tick(), PROBE_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [onActivityChanged, activityEndpoint]);
}
