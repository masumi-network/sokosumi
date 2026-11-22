"use client";

import { type RefObject, useEffect } from "react";

/**
 * Tracks whether `StudioCompare` is mounted and cancels any pending post-pick
 * auto-advance timeout on unmount or React `<Activity>` hide.
 */
export function useStudioCompareMountLifecycle(
  active: RefObject<boolean>,
  advanceTimer: RefObject<ReturnType<typeof setTimeout> | null>,
): void {
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);
}
