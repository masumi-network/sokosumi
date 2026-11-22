"use client";

import { type RefObject, useEffect } from "react";

/**
 * Observes `ContactsGrid`'s bottom sentinel row and calls `onLoadMore` when it
 * intersects while `hasMore` is true. Keeps `[hasMore, onLoadMore]` as deps
 * verbatim so a fresh `onLoadMore` after each page re-arms observation for a
 * still-visible sentinel.
 */
export function useContactsGridInfiniteScroll(
  sentinel: RefObject<HTMLTableRowElement | null>,
  hasMore: boolean,
  onLoadMore: () => void,
): void {
  // Infinite scroll: the sentinel under the last row asks for the next page.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);
}
