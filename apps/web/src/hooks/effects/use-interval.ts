"use client";

import { useEffect, useEffectEvent } from "react";

export interface UseIntervalOptions {
  /** Call `callback` immediately when the interval starts or resumes. */
  immediate?: boolean;
}

/**
 * Calls `callback` every `delayMs` milliseconds. Passing `null` pauses the
 * interval. Updating `callback` never resets the timer.
 */
export function useInterval(
  callback: () => void,
  delayMs: number | null,
  options?: UseIntervalOptions,
): void {
  const onTick = useEffectEvent(callback);
  const immediate = options?.immediate ?? false;

  useEffect(() => {
    if (delayMs === null) return;
    if (immediate) {
      onTick();
    }
    const id = setInterval(() => {
      onTick();
    }, delayMs);
    return () => clearInterval(id);
  }, [delayMs, immediate]);
}
