"use client";

import { useEffect, useState } from "react";

export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

/**
 * Ticks a whole-seconds elapsed counter anchored to `startedAt` (wall-clock
 * ms). Null falls back to "now" — the counter still runs, it just won't
 * survive a remount. Shared by the provisioning and onboarding loaders so
 * both phases show the same persisted-anchor elapsed clock.
 */
export function useElapsedSeconds(startedAt: number | null): number {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0,
  );

  useEffect(() => {
    const anchor = startedAt ?? Date.now();
    const update = () =>
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - anchor) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return elapsedSeconds;
}
