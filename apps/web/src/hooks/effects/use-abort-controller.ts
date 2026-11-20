"use client";

import { useEffect, useMemo, useRef } from "react";

export interface ManagedAbortController {
  /** Aborts any active controller, tracks a fresh one, and returns it. */
  start: () => AbortController;
  /** Synchronously aborts any active controller and clears tracking. */
  abort: () => void;
  /** Clears tracking when `controller` is still the active one. */
  release: (controller: AbortController) => void;
  /** Whether a controller is currently tracked as active. */
  isActive: () => boolean;
}

/**
 * Manages a single handler-started `AbortController` and aborts it on unmount
 * or whenever `resetKey` changes.
 */
export function useAbortController(resetKey?: unknown): ManagedAbortController {
  const activeRef = useRef<AbortController | null>(null);

  const handle = useMemo<ManagedAbortController>(
    () => ({
      start() {
        activeRef.current?.abort();
        const controller = new AbortController();
        activeRef.current = controller;
        return controller;
      },
      abort() {
        activeRef.current?.abort();
        activeRef.current = null;
      },
      release(controller) {
        if (activeRef.current === controller) {
          activeRef.current = null;
        }
      },
      isActive() {
        return activeRef.current !== null;
      },
    }),
    [],
  );

  useEffect(() => {
    void resetKey;
    return () => {
      handle.abort();
    };
  }, [handle, resetKey]);

  return handle;
}

export interface ManagedAbortControllers {
  /** Creates and tracks a new `AbortController` alongside any active ones. */
  create: () => AbortController;
  /** Stops tracking a finished controller. */
  release: (controller: AbortController) => void;
  /** Synchronously aborts every tracked controller and clears the set. */
  abortAll: () => void;
}

/**
 * Tracks a set of concurrent handler-started `AbortController`s and aborts
 * all remaining ones on unmount or whenever `resetKey` changes.
 */
export function useAbortControllers(
  resetKey?: unknown,
): ManagedAbortControllers {
  const activeRef = useRef(new Set<AbortController>());

  const handle = useMemo<ManagedAbortControllers>(
    () => ({
      create() {
        const controller = new AbortController();
        activeRef.current.add(controller);
        return controller;
      },
      release(controller) {
        activeRef.current.delete(controller);
      },
      abortAll() {
        for (const controller of activeRef.current) {
          controller.abort();
        }
        activeRef.current.clear();
      },
    }),
    [],
  );

  useEffect(() => {
    void resetKey;
    return () => {
      handle.abortAll();
    };
  }, [handle, resetKey]);

  return handle;
}
