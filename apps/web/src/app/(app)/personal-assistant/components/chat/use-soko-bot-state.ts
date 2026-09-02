import { useCallback, useEffect, useRef, useState } from "react";

import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";

const STATE_ENDPOINT = "/api/personal-assistant/state";
const ACTIVITY_ENDPOINT = "/api/personal-assistant/activity";
/**
 * How often the cheap probe runs. Turns are short — five to twenty seconds —
 * and this surface watches ones it did not start, so anything slower means a
 * turn begins and ends between two ticks and is only ever seen finished.
 */
const PROBE_MS = 2_500;

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
 * Keeps the chat projection fresh.
 *
 * Two endpoints, deliberately. The probe is one indexed read and runs often
 * enough to notice a turn while it is still running; the full state loads the
 * bot plus twenty turns with their events and decisions, and is fetched only
 * when the probe says something moved, or while a turn is in flight.
 */
export function useSokoBotState(initial: SokoBotChatState) {
  const [state, setState] = useState(initial);
  const refreshing = useRef(false);
  const lastSignature = useRef<string | null>(null);

  useEffect(() => {
    setState(initial);
  }, [initial]);

  const refresh = useCallback(async () => {
    // Skipped, never cancelled. Aborting the previous read meant that if
    // /state took longer than one probe interval, every response while the
    // turn was running got cancelled by the next tick and only the one after
    // it settled ever landed — the exact "finished answer, no orb" symptom
    // this set out to fix.
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const response = await fetch(STATE_ENDPOINT, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        state?: SokoBotChatState | null;
      };
      if (body.state) setState(body.state);
    } catch {
      // Offline: the next tick retries.
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    let stopped = false;

    async function tick() {
      if (document.visibilityState !== "visible" || stopped) return;
      try {
        const response = await fetch(ACTIVITY_ENDPOINT, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { activity?: Activity | null };
        if (!body.activity || stopped) return;
        const signature = activitySignature(body.activity);
        // Refetch while a turn is running, so its steps keep arriving, and
        // once more on the tick where it settles.
        const changed = signature !== lastSignature.current;
        lastSignature.current = signature;
        if (changed || body.activity.activeTurnId !== null) await refresh();
      } catch {
        // Offline or aborted: the next tick retries.
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
  }, [refresh]);

  return { state, refresh };
}
