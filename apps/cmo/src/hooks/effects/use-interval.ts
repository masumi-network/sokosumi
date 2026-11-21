"use client";

import { useEffect, useEffectEvent } from "react";

/**
 * Calls `callback` every `delayMs` milliseconds. Passing `null` pauses the
 * interval. Updating `callback` never resets the timer.
 */
export function useInterval(
  callback: () => void,
  delayMs: number | null,
): void {
  const onTick = useEffectEvent(callback);

  useEffect(() => {
    if (delayMs === null) return;
    const id = setInterval(() => {
      onTick();
    }, delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}
