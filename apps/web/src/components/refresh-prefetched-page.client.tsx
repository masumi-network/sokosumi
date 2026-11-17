"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";

/**
 * Back and forward show the page the browser kept, which can be minutes old.
 * A page that mounts within this window after a `popstate` came from one.
 */
const TRAVERSAL_WINDOW_MS = 1_000;

/**
 * A click reuses the layouts the pages share (session, workspace lock), so
 * their reads stay as old as the last refresh. Arriving on a page refreshes
 * them once this long has passed.
 */
export const LAYOUT_REFRESH_MS = 2 * 60_000;

const PREFETCHED_CONTENT_STALE_MS = PREFETCHED_CONTENT_STALE_SECONDS * 1000;

let traversedAt = Number.NEGATIVE_INFINITY;
// The document load rendered everything fresh.
let refreshedAt = Number.NEGATIVE_INFINITY;
/**
 * When each page first showed since the last refresh. A content prefetch of
 * a page visited in the last 5 minutes (Next's `staleTimes.static`) takes
 * that visit's copy with no request, and each return keeps the same data in
 * it. So any return more than the prefetch stale time after the first visit
 * may open an old copy. A page's query variants share one entry, so the
 * earliest of them counts. A refresh drops every copy and clears this map,
 * so every entry is newer than `refreshedAt`.
 */
const visitedAt = new Map<string, number>();
if (typeof window !== "undefined") {
  refreshedAt = performance.timeOrigin;
  window.addEventListener("popstate", () => {
    traversedAt = Date.now();
  });
}

function shouldRefresh(page: string, everyVisit: boolean): boolean {
  const now = Date.now();
  const lastVisit = visitedAt.get(page);
  return (
    everyVisit ||
    now - traversedAt <= TRAVERSAL_WINDOW_MS ||
    now - refreshedAt > LAYOUT_REFRESH_MS ||
    (lastVisit !== undefined && now - lastVisit > PREFETCHED_CONTENT_STALE_MS)
  );
}

function subscribeToNothing() {
  return () => {};
}

/**
 * Renders the page again when it may show an old copy: after back or
 * forward, on a return to a page first visited, since the last refresh,
 * longer than the prefetch stale time ago, or when the shared layouts are older than
 * `LAYOUT_REFRESH_MS`. A
 * click opens page data that is fresh or at most
 * `PREFETCHED_CONTENT_STALE_SECONDS` old, so it does not refresh on every
 * arrival: a refresh drops every page prefetched for the next click. A
 * document load is already fresh, so the first effect after hydration does
 * nothing. Next keeps recent pages in a hidden `<Activity>` and shows them
 * again with their state, so each later effect run is a new visit.
 */
export function RefreshPrefetchedPage({
  everyVisit = false,
}: {
  /** Refresh on each arrival, for a page whose cached copy must not linger. */
  everyVisit?: boolean;
}) {
  const router = useRouter();
  // The server snapshot answers only during hydration.
  const mountedByHydration = useSyncExternalStore(
    subscribeToNothing,
    () => false,
    () => true,
  );
  const skipNextRefresh = useRef(mountedByHydration);

  useEffect(() => {
    const page = window.location.pathname;
    const refresh = shouldRefresh(page, everyVisit);
    if (!visitedAt.has(page)) visitedAt.set(page, Date.now());
    if (skipNextRefresh.current) {
      skipNextRefresh.current = false;
      return;
    }
    if (!refresh) return;
    refreshedAt = Date.now();
    traversedAt = Number.NEGATIVE_INFINITY;
    visitedAt.clear();
    visitedAt.set(page, refreshedAt);
    // Full route refresh: the kept page holds several private-cached reads,
    // and no single tag or path invalidates only them.
    router.refresh();
  }, [router, everyVisit]);

  return null;
}
