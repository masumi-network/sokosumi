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
/** A state read that outlives this is abandoned rather than held onto. */
const STATE_TIMEOUT_MS = 15_000;
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
  const queued = useRef(false);
  const lastSignature = useRef<string | null>(null);

  useEffect(() => {
    setState(initial);
  }, [initial]);

  const refresh = useCallback(async () => {
    // Coalesced, not dropped, and never cancelled.
    //
    // Cancelling was the first bug: a /state read slower than one probe tick
    // was aborted by the next one, so only the read after the turn settled
    // ever landed. Plain skipping was the second: the tick that saw the turn
    // settle could have its read skipped, the slow in-flight response would
    // then restore the running state, and since the signature had already
    // been recorded no later tick would ask again — the orb stuck forever.
    // One queued follow-up read fixes that without stacking requests.
    if (refreshing.current) {
      queued.current = true;
      return;
    }
    refreshing.current = true;
    try {
      do {
        queued.current = false;
        // A request that never settles would otherwise hold the flag and stop
        // every future read, which is worse than the bug above. Built from a
        // controller rather than `AbortSignal.timeout` so the deadline is
        // ordinary code a test can drive.
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), STATE_TIMEOUT_MS);
        try {
          const response = await fetch(STATE_ENDPOINT, {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) return;
          const body = (await response.json()) as {
            state?: SokoBotChatState | null;
          };
          if (body.state) setState(body.state);
        } finally {
          clearTimeout(deadline);
        }
      } while (queued.current);
    } catch {
      // Offline or timed out: the next tick retries.
    } finally {
      refreshing.current = false;
    }
  }, []);

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
        const response = await fetch(ACTIVITY_ENDPOINT, {
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
        await refresh();
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
  }, [refresh]);

  return { state, refresh };
}
