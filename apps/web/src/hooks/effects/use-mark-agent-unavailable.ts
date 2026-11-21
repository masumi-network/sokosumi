"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Agents whose detail page would 404 (deleted or no access) while their
 * historical jobs stay open. Ref-counted so an overlapping route transition
 * for the same agent does not clear the newer page's mark on unmount.
 */
const unavailableCounts = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Marks `agentId` as unavailable while mounted so the mobile top bar falls
 * back to the catalog instead of linking to a 404 agent detail page.
 */
export function useMarkAgentUnavailable(agentId: string): void {
  useEffect(() => {
    unavailableCounts.set(agentId, (unavailableCounts.get(agentId) ?? 0) + 1);
    emit();
    return () => {
      const next = (unavailableCounts.get(agentId) ?? 1) - 1;
      if (next <= 0) {
        unavailableCounts.delete(agentId);
      } else {
        unavailableCounts.set(agentId, next);
      }
      emit();
    };
  }, [agentId]);
}

export function useIsAgentUnavailable(agentId: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => agentId !== null && (unavailableCounts.get(agentId) ?? 0) > 0,
    getServerSnapshot,
  );
}
