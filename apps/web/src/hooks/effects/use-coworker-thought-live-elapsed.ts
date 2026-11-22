"use client";

import { useEffect, useState } from "react";

/**
 * Deterministic first paint (SSR/client match), then live clock after mount.
 * Seeding with `startedAtMs` yields 0.0s until the effect runs.
 */
export function useCoworkerThoughtLiveElapsed(startedAtMs: number): number {
  const [now, setNow] = useState(startedAtMs);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [startedAtMs]);
  return Math.max(0, now - startedAtMs);
}
