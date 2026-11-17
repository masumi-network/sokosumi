"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

function subscribeToNothing() {
  return () => {};
}

/**
 * Renders the page again after a client navigation, so a page that opened
 * from its link prefetch swaps in fresh data in place. A document load is
 * already fresh, so the first effect after hydration does nothing. Next keeps
 * recent pages in a hidden `<Activity>` and shows them again with their state,
 * so each later effect run is a new visit and refreshes.
 */
export function RefreshPrefetchedPage() {
  const router = useRouter();
  // The server snapshot answers only during hydration.
  const mountedByHydration = useSyncExternalStore(
    subscribeToNothing,
    () => false,
    () => true,
  );
  const skipNextRefresh = useRef(mountedByHydration);

  useEffect(() => {
    if (skipNextRefresh.current) {
      skipNextRefresh.current = false;
      return;
    }
    // Full route refresh: the prefetched page holds several private-cached
    // reads, and no single tag or path invalidates only them.
    router.refresh();
  }, [router]);

  return null;
}
