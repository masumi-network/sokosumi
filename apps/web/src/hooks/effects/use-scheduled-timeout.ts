"use client";

import { useEffect, useMemo, useRef } from "react";

export interface ScheduledTimeout {
  /** Synchronously cancels any pending timeout and schedules a new one. */
  schedule: (callback: () => void, delayMs: number) => void;
  /** Synchronously cancels any pending timeout. */
  cancel: () => void;
  /** Whether a timeout is currently scheduled and has not yet fired. */
  isPending: () => boolean;
}

/**
 * Imperative single-slot timeout started from an event handler or async step,
 * with synchronous cancellation and automatic cleanup on unmount.
 */
export function useScheduledTimeout(): ScheduledTimeout {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handle = useMemo<ScheduledTimeout>(
    () => ({
      schedule(callback, delayMs) {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          callback();
        }, delayMs);
      },
      cancel() {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      },
      isPending() {
        return timerRef.current !== null;
      },
    }),
    [],
  );

  useEffect(() => () => handle.cancel(), [handle]);

  return handle;
}

export interface ScheduledTimeoutMap<K = string> {
  /** Synchronously replaces any pending timeout for `key` and schedules a new one. */
  schedule: (key: K, callback: () => void, delayMs: number) => void;
  /** Synchronously cancels any pending timeout for `key`. */
  cancel: (key: K) => void;
  /** Synchronously cancels every pending timeout in the map. */
  cancelAll: () => void;
  /** Whether `key` currently has a pending timeout. */
  has: (key: K) => boolean;
}

/**
 * Imperative map of keyed timeouts started from event handlers, with
 * synchronous per-key cancellation and automatic cleanup on unmount.
 */
export function useScheduledTimeoutMap<K = string>(): ScheduledTimeoutMap<K> {
  const timersRef = useRef(new Map<K, ReturnType<typeof setTimeout>>());

  const handle = useMemo<ScheduledTimeoutMap<K>>(
    () => ({
      schedule(key, callback, delayMs) {
        const existing = timersRef.current.get(key);
        if (existing !== undefined) {
          clearTimeout(existing);
        }
        const id = setTimeout(() => {
          timersRef.current.delete(key);
          callback();
        }, delayMs);
        timersRef.current.set(key, id);
      },
      cancel(key) {
        const existing = timersRef.current.get(key);
        if (existing !== undefined) {
          clearTimeout(existing);
          timersRef.current.delete(key);
        }
      },
      cancelAll() {
        for (const id of timersRef.current.values()) {
          clearTimeout(id);
        }
        timersRef.current.clear();
      },
      has(key) {
        return timersRef.current.has(key);
      },
    }),
    [],
  );

  useEffect(() => () => handle.cancelAll(), [handle]);

  return handle;
}
