"use client";

import { useEffect, useEffectEvent, useRef } from "react";

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
  const activeRef = useRef(false);

  useEffect(() => {
    if (delayMs === null) {
      activeRef.current = false;
      return;
    }
    if (immediate && !activeRef.current) {
      onTick();
    }
    activeRef.current = true;
    const id = setInterval(() => {
      onTick();
    }, delayMs);
    return () => clearInterval(id);
  }, [delayMs, immediate]);
}
