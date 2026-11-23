"use client";

import { type RefObject, useEffect } from "react";

/**
 * Tracks `FeatureBadgesProvider` mount state and clears scheduled pill exit
 * timers on hide or unmount.
 */
export function useFeatureBadgesLifecycle(
  mounted: RefObject<boolean>,
  exitTimers: RefObject<Map<string, number[]>>,
): void {
  useEffect(() => {
    mounted.current = true;
    const timers = exitTimers.current;
    return () => {
      mounted.current = false;
      for (const ids of timers.values()) ids.forEach(window.clearTimeout);
      timers.clear();
    };
  }, []);
}
