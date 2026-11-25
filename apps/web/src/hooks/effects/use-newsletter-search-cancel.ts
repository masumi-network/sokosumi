"use client";

import { useEffect, useEffectEvent, useRef } from "react";

export interface UseNewsletterSearchCancelOptions {
  navKey: string;
  debouncedSearch: { cancel: () => void };
}

/**
 * Cancels a pending debounced newsletter search timer when external navigation
 * changes `navKey` or when the view unmounts, keeping timer cancellation out of
 * render.
 */
export function useNewsletterSearchCancel({
  navKey,
  debouncedSearch,
}: UseNewsletterSearchCancelOptions): void {
  const cancelSearch = useEffectEvent(() => {
    debouncedSearch.cancel();
  });
  const prevNavKey = useRef(navKey);

  useEffect(() => {
    if (prevNavKey.current !== navKey) {
      prevNavKey.current = navKey;
      cancelSearch();
    }
  }, [navKey]);

  useEffect(() => () => cancelSearch(), []);
}
