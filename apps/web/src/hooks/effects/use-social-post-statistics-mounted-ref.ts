"use client";

import { type RefObject, useEffect } from "react";

/**
 * Marks `SocialPostStatistics` mounted so async refresh loops skip state
 * updates and query invalidations after unmount.
 */
export function useSocialPostStatisticsMountedRef(
  mountedRef: RefObject<boolean>,
): void {
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
}
