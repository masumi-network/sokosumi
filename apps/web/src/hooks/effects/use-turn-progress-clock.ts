"use client";

import { useEffect, useState } from "react";

/**
 * Tracks a 1-second ticking epoch clock for `TurnProgress` escalation copy
 * while `startedAt` is present.
 */
export function useTurnProgressClock(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return now;
}
