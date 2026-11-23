"use client";

import { type RefObject, useEffect } from "react";

/** Campaigns this new are not read again by a returning tab or a navigation. */
export const CAMPAIGNS_STALE_MS = 60_000;

interface UseFeatureBadgesNavigationRefreshOptions {
  pathname: string;
  lastPathname: RefObject<string>;
  dataUpdatedAt: number;
  refetch: () => Promise<unknown>;
}

/**
 * Refreshes sidebar badge campaigns on pathname changes once the cached data is
 * at least `CAMPAIGNS_STALE_MS` old.
 */
export function useFeatureBadgesNavigationRefresh({
  pathname,
  lastPathname,
  dataUpdatedAt,
  refetch,
}: UseFeatureBadgesNavigationRefreshOptions): void {
  useEffect(() => {
    if (lastPathname.current !== pathname) {
      lastPathname.current = pathname;
      // A navigation reads again only when the campaigns are a minute old,
      // like a returning tab. A read on every page change cost a Core round
      // trip each time.
      if (Date.now() - dataUpdatedAt >= CAMPAIGNS_STALE_MS) void refetch();
    }
  }, [pathname, refetch, dataUpdatedAt]);
}
