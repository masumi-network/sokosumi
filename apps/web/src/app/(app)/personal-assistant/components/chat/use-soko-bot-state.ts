import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatTurn, SokoBotChatState } from "@/lib/soko-bot/chat-state";

import { hasActiveTurn } from "./timeline";

const STATE_ENDPOINT = "/api/personal-assistant/state";
const ACTIVE_POLL_MS = 2_500;
const IDLE_POLL_MS = 30_000;

/**
 * Keeps the chat projection fresh: fast polling while a turn runs, a slow
 * heartbeat otherwise (scheduled turns can land while the tab is open), and
 * an explicit `refresh()` after any mutation. Optimistic turns survive until
 * Core echoes the real one back (matched on `clientTurnId`).
 */
export function useSokoBotState(initial: SokoBotChatState) {
  const [state, setState] = useState(initial);
  const optimisticRef = useRef<Map<string, ChatTurn>>(new Map());
  const inFlight = useRef<AbortController | null>(null);

  const merge = useCallback((next: SokoBotChatState) => {
    const known = new Set(next.turns.map((turn) => turn.id));
    for (const [clientTurnId, turn] of optimisticRef.current) {
      if (known.has(clientTurnId) || next.turns.some((t) => t.id === turn.id)) {
        optimisticRef.current.delete(clientTurnId);
      }
    }
    const pending = Array.from(optimisticRef.current.values());
    setState({ bot: next.bot, turns: [...pending, ...next.turns] });
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

  const active = hasActiveTurn(state);
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

  const addOptimisticTurn = useCallback(
    (clientTurnId: string, userMessage: string) => {
      const turn: ChatTurn = {
        id: `optimistic:${clientTurnId}`,
        source: "CHAT",
        status: "QUEUED",
        route: null,
        userMessage,
        finalAnswer: null,
        errorKind: null,
        errorDetail: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        createdAt: new Date().toISOString(),
        events: [],
        delegations: [],
        decisions: [],
        requestedBy: null,
        chatRoom: null,
        optimistic: true,
      };
      optimisticRef.current.set(clientTurnId, turn);
      setState((current) => ({ ...current, turns: [turn, ...current.turns] }));
    },
    [],
  );

  const bindOptimisticTurn = useCallback(
    (clientTurnId: string, turnId: string) => {
      const turn = optimisticRef.current.get(clientTurnId);
      if (!turn) return;
      const bound = { ...turn, id: turnId, status: "STARTING" as const };
      optimisticRef.current.set(clientTurnId, bound);
      setState((current) => ({
        ...current,
        turns: current.turns.map((t) => (t.id === turn.id ? bound : t)),
      }));
    },
    [],
  );

  const dropOptimisticTurn = useCallback((clientTurnId: string) => {
    const turn = optimisticRef.current.get(clientTurnId);
    optimisticRef.current.delete(clientTurnId);
    if (!turn) return;
    setState((current) => ({
      ...current,
      turns: current.turns.filter((t) => t.id !== turn.id),
    }));
  }, []);

  return {
    state,
    refresh,
    addOptimisticTurn,
    bindOptimisticTurn,
    dropOptimisticTurn,
  };
}
