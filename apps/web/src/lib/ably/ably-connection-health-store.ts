import { useSyncExternalStore } from "react";

/**
 * Whether the shared Ably connection is currently connected, as last reported
 * by an Ably island. Chat refresh consumers outside the Ably provider (the
 * sidebar collections, the mobile unread dot) read it to pick the healthy
 * 60-second recovery cadence over the fallback poll (SOK-986).
 *
 * Kept free of the Ably SDK so reading it never pulls the SDK into a bundle.
 * Unknown (no island mounted yet) reads as unhealthy, so a page that never
 * loads Ably keeps the fallback cadence it has today.
 */
let connected = false;
const listeners = new Set<() => void>();

export function setAblyConnectionHealthy(next: boolean): void {
  if (connected === next) {
    return;
  }
  connected = next;
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

function getSnapshot(): boolean {
  return connected;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useAblyConnectionHealthy(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
