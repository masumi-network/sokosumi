"use client";

import { useEffect, useEffectEvent } from "react";

/**
 * Calls `callback` once after `delayMs` milliseconds. Passing `null` cancels
 * any pending timer. Updating `callback` never resets the timer; pass a
 * changing `resetKey` to restart the timeout with the same `delayMs`.
 */
export function useTimeout(
  callback: () => void,
  delayMs: number | null,
  resetKey?: unknown,
): void {
  const onTimeout = useEffectEvent(callback);

  useEffect(() => {
    void resetKey;
    if (delayMs === null) return;
    const id = setTimeout(() => {
      onTimeout();
    }, delayMs);
    return () => clearTimeout(id);
  }, [delayMs, resetKey]);
}
