import { useCallback, useEffect, useRef, useState } from "react";

import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";

import { hasActiveTurn } from "./timeline";

const STATE_ENDPOINT = "/api/personal-assistant/state";
const ACTIVE_POLL_MS = 2_500;
// Turns run five to twenty seconds. At thirty a turn could start and finish
// between two ticks, so the console would only ever render the finished
// answer. This is the cost of watching work started somewhere else.
const IDLE_POLL_MS = 8_000;

/**
 * Keeps the chat projection fresh: fast polling while a turn runs, a slow
 * heartbeat otherwise (scheduled turns can land while the tab is open), and
 * an explicit `refresh()` after any mutation.
 */
export function useSokoBotState(initial: SokoBotChatState) {
  const [state, setState] = useState(initial);
  const inFlight = useRef<AbortController | null>(null);

  const merge = useCallback((next: SokoBotChatState) => {
    setState(next);
  }, []);

  useEffect(() => {
    merge(initial);
  }, [initial, merge]);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
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
      if (body.state && !controller.signal.aborted) merge(body.state);
    } catch {
      // Aborted or offline: the next tick retries.
    }
  }, [merge]);

  // The bot's own status counts as activity, not only a turn already in the
  // list. Conversation moved to the chat rooms, so the console watches turns
  // it did not start: at the idle rate a turn could begin and finish inside
  // one tick, and the console would only ever show the finished answer — no
  // orb, no steps, nothing to say it had been working.
  const active = hasActiveTurn(state) || state.bot.status === "RUNNING";
  useEffect(() => {
    const interval = setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      active ? ACTIVE_POLL_MS : IDLE_POLL_MS,
    );
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, refresh]);

  return { state, refresh };
}
