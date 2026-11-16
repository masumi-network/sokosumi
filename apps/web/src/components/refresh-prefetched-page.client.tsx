"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

function subscribeToNothing() {
  return () => {};
}

/**
 * Renders the page again once after a client navigation, so a page that
 * opened from its link prefetch swaps in fresh data in place. A document load
 * is already fresh, so a mount during hydration does nothing.
 */
export function RefreshPrefetchedPage() {
  const router = useRouter();
  // The server snapshot answers only during hydration.
  const mountedByHydration = useSyncExternalStore(
    subscribeToNothing,
    () => false,
    () => true,
  );
  const [openedFromNavigation] = useState(!mountedByHydration);

  useEffect(() => {
    if (openedFromNavigation) {
      // Full route refresh: the prefetched page holds several private-cached
      // reads, and no single tag or path invalidates only them.
      router.refresh();
    }
  }, [openedFromNavigation, router]);

  return null;
}
