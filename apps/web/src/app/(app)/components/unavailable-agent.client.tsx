"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Agents whose detail page would 404 (deleted or no access) while their
 * historical jobs stay open. The mobile top bar sits outside the jobs layout,
 * so the layout marks the agent here and the top bar's Back falls back to the
 * catalog instead of the agent page.
 */
const unavailable = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function MarkAgentUnavailable({ agentId }: { agentId: string }) {
  useEffect(() => {
    unavailable.add(agentId);
    emit();
    return () => {
      unavailable.delete(agentId);
      emit();
    };
  }, [agentId]);
  return null;
}

export function useIsAgentUnavailable(agentId: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => agentId !== null && unavailable.has(agentId),
    () => false,
  );
}
