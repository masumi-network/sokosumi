"use client";

import { useEffect, useState } from "react";

/**
 * Schedules a timeout for the earliest upcoming badge campaign expiry (`nextEnd`)
 * and increments a tick so active campaigns re-filter without refetching.
 */
export function useFeatureBadgeExpiryTick(nextEnd: number): number {
  const [clockTick, tick] = useState(0);

  useEffect(() => {
    if (!Number.isFinite(nextEnd)) return;
    const timer = window.setTimeout(
      () => tick((current) => current + 1),
      Math.min(nextEnd - Date.now(), 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [nextEnd]);

  return clockTick;
}
