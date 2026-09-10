import { useSyncExternalStore } from "react";

/**
 * Whether realtime is delivering, as last reported by an Ably island.
 *
 * Chat refresh consumers outside the Ably provider (the sidebar collections,
 * the mobile unread dot) read this to pick the healthy 60-second recovery
 * cadence over the fallback poll (SOK-986). "Delivering" is the TCP
 * connection *and* a successful token callback. A failed authorize can leave
 * the socket `connected` with no channels attached; treating that as healthy
 * kept the fallback pollers off while nothing arrived.
 *
 * Kept free of the Ably SDK so reading it never pulls the SDK into a bundle.
 * Unknown (no island mounted yet) reads as unhealthy, so a page that never
 * loads Ably keeps the fallback cadence it has today.
 */
let connectionConnected = false;
let authOk = false;
const listeners = new Set<() => void>();

function isHealthy(): boolean {
  return connectionConnected && authOk;
}

function emitIfChanged(previous: boolean): void {
  if (previous === isHealthy()) {
    return;
  }
  for (const listener of listeners) {
    listener();
  }
}

/**
 * TCP / connection-state half of health. True only for `connected`.
 */
export function reportAblyConnectionConnected(connected: boolean): void {
  const previous = isHealthy();
  connectionConnected = connected;
  emitIfChanged(previous);
}

/**
 * Token-callback half of health. True after a successful mint; false after
 * any auth failure (401, 502, timeout).
 */
export function reportAblyAuthOk(ok: boolean): void {
  const previous = isHealthy();
  authOk = ok;
  emitIfChanged(previous);
}

/**
 * Force both halves to `next`. Tests use this to reset or to stub the
 * combined flag without driving connection + auth separately.
 */
export function setAblyConnectionHealthy(next: boolean): void {
  const previous = isHealthy();
  connectionConnected = next;
  authOk = next;
  emitIfChanged(previous);
}

export function getAblyConnectionHealthy(): boolean {
  return isHealthy();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return isHealthy();
}

function getServerSnapshot(): boolean {
  return false;
}

export function useAblyConnectionHealthy(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
