"use client";

import { useEffect, useState } from "react";

/**
 * Tracks a 1-second ticking epoch clock for `ElapsedTimer` in Soko Bot chat.
 */
export function useElapsedTimerClock(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return now;
}
