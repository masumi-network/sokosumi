"use client";

import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Automatically advances a paginated list once per cursor while a page search
 * is active, resetting deduplication when the search clears.
 */
export function usePageSearchAutoLoadMore(
  searching: boolean,
  cursor: string | null | undefined,
  busy: boolean,
  loadMore: () => unknown,
): void {
  const requested = useRef<string | null>(null);
  const load = useEffectEvent(loadMore);
  useEffect(() => {
    if (!searching) {
      requested.current = null;
      return;
    }
    if (!cursor || busy || requested.current === cursor) return;
    requested.current = cursor;
    void load();
  }, [searching, cursor, busy]);
}
