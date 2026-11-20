"use client";

import {
  type ComponentType,
  type ReactNode,
  useSyncExternalStore,
} from "react";

type AblyProviderComponent = ComponentType<{ children: ReactNode }>;

interface AblyProviderSnapshot {
  Provider: AblyProviderComponent | null;
  loadError: Error | null;
}

const INITIAL_SNAPSHOT: AblyProviderSnapshot = {
  Provider: null,
  loadError: null,
};

let snapshot: AblyProviderSnapshot = INITIAL_SNAPSHOT;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function ensureAblyProviderLoaded(): void {
  if (snapshot.Provider || loadPromise) {
    return;
  }

  const pending = import("./ably-provider")
    .then((module) => {
      if (loadPromise !== pending) {
        return;
      }
      snapshot = { Provider: module.default, loadError: null };
      notifyListeners();
    })
    .catch((error: unknown) => {
      if (loadPromise !== pending) {
        return;
      }
      snapshot = {
        Provider: null,
        loadError: new Error("Failed to load Ably provider", {
          cause: error,
        }),
      };
      notifyListeners();
    });

  loadPromise = pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureAblyProviderLoaded();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && snapshot.loadError) {
      loadPromise = null;
      snapshot = INITIAL_SNAPSHOT;
    }
  };
}

function getSnapshot(): AblyProviderSnapshot {
  return snapshot;
}

function getServerSnapshot(): AblyProviderSnapshot {
  return INITIAL_SNAPSHOT;
}

interface LazyAblyProviderProps {
  children: ReactNode;
}

/**
 * Mount-gated Ably island gate. Returns null until `ably-provider` loads, then
 * wraps children. Use as a sibling of paint-critical UI — not as an app-shell
 * parent — so Instant chrome is never blocked on the Ably chunk.
 * Multiple instances share one realtime client via `getAblyRealtimeClient()`.
 */
export default function LazyAblyProvider({ children }: LazyAblyProviderProps) {
  const { Provider, loadError } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  if (loadError) {
    throw loadError;
  }

  // Do not mount children until AblyProvider is ready — ChannelProvider /
  // useChannel throw without Ably React context.
  if (!Provider) {
    return null;
  }

  return <Provider>{children}</Provider>;
}
