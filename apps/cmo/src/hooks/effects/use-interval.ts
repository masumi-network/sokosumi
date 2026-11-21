"use client";

import { useEffect, useEffectEvent } from "react";

export interface UseIntervalOptions {
  /** Call `callback` immediately when the interval starts or resumes. */
  immediate?: boolean;
  /** Re-runs the interval when this value changes while `delayMs` stays the same. */
  resetKey?: unknown;
}

/**
 * Calls `callback` every `delayMs` milliseconds. Passing `null` pauses the
 * interval. Updating `callback` never resets the timer; pass a changing
 * `resetKey` to restart the interval with the same `delayMs`.
 */
export function useInterval(
  callback: () => void,
  delayMs: number | null,
  options?: UseIntervalOptions,
): void {
  const onTick = useEffectEvent(callback);
  const immediate = options?.immediate ?? false;
  const resetKey = options?.resetKey;

  useEffect(() => {
    void resetKey;
    if (delayMs === null) return;
    if (immediate) {
      onTick();
    }
    const id = setInterval(() => {
      onTick();
    }, delayMs);
    return () => clearInterval(id);
  }, [delayMs, immediate, resetKey]);
}
