"use client";

import { useRefreshPrefetchedPage } from "@/hooks/effects/use-refresh-prefetched-page";

/**
 * Renders the page again when it may show an old copy: after back or
 * forward, on a return to a page first visited, since its last refresh,
 * longer than the prefetch stale time ago, when the shared layouts are
 * older than `LAYOUT_REFRESH_MS`, or when a browser-side mutation marked the
 * page stale with `markPageStale`. A click opens page data that is fresh or at
 * most `PREFETCHED_CONTENT_STALE_SECONDS` old, so it does not refresh on every
 * arrival. The refresh runs as a Server Action, which keeps the pages loaded
 * for the next click. A document load is already fresh, so the first effect
 * after hydration does nothing. Next keeps recent pages in a hidden
 * `<Activity>` and shows them again with their state, so each later effect run
 * is a new visit, and hiding the page cancels a refresh still waiting.
 */
export function RefreshPrefetchedPage({
  everyVisit = false,
}: {
  /** Refresh on each arrival, for a page whose cached copy must not linger. */
  everyVisit?: boolean;
}) {
  useRefreshPrefetchedPage(everyVisit);

  return null;
}
