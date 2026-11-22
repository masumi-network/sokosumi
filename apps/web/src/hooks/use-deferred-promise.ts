"use client";

import { useCallback, useSyncExternalStore } from "react";

type DeferredPromiseSnapshot<T> =
  | { settled: false }
  | { settled: true; value: T }
  | { settled: true; rejected: true };

interface DeferredPromiseEntry<T> {
  snapshot: DeferredPromiseSnapshot<T>;
  attached: boolean;
  listeners: Set<() => void>;
}

const PENDING_SNAPSHOT: DeferredPromiseSnapshot<never> = { settled: false };

const promiseEntries = new WeakMap<
  Promise<unknown>,
  DeferredPromiseEntry<unknown>
>();

function getOrCreateEntry<T>(promise: Promise<T>): DeferredPromiseEntry<T> {
  let entry = promiseEntries.get(promise) as
    | DeferredPromiseEntry<T>
    | undefined;
  if (!entry) {
    entry = {
      snapshot: PENDING_SNAPSHOT,
      attached: false,
      listeners: new Set(),
    };
    promiseEntries.set(promise, entry as DeferredPromiseEntry<unknown>);
  }
  return entry;
}

function subscribeToPromise<T>(
  promise: Promise<T>,
  listener: () => void,
): () => void {
  const entry = getOrCreateEntry(promise);
  entry.listeners.add(listener);
  if (!entry.attached) {
    entry.attached = true;
    void promise.then(
      (value) => {
        entry.snapshot = { settled: true, value };
        for (const notify of entry.listeners) {
          notify();
        }
      },
      () => {
        entry.snapshot = { settled: true, rejected: true };
        for (const notify of entry.listeners) {
          notify();
        }
      },
    );
  }
  return () => {
    entry.listeners.delete(listener);
  };
}

function getServerSnapshot(): DeferredPromiseSnapshot<never> {
  return PENDING_SNAPSHOT;
}

/**
 * Reads a deferred server/client Promise without suspending the caller or
 * syncing through an Effect. Returns `undefined` while pending (and during
 * SSR), the fulfilled value once resolved, or `fallbackOnReject` if rejected.
 */
export function useDeferredPromise<T>(
  promise: Promise<T> | null | undefined,
  fallbackOnReject: T,
): T | undefined {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!promise) return () => {};
      return subscribeToPromise(promise, listener);
    },
    [promise],
  );
  const getSnapshot = useCallback((): DeferredPromiseSnapshot<T> => {
    if (!promise) return PENDING_SNAPSHOT;
    return (
      (promiseEntries.get(promise) as DeferredPromiseEntry<T> | undefined)
        ?.snapshot ?? PENDING_SNAPSHOT
    );
  }, [promise]);
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  if (!snapshot.settled) return undefined;
  return "rejected" in snapshot ? fallbackOnReject : snapshot.value;
}
