"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { refreshPage } from "@/lib/actions/refresh-page-action";
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

/**
 * A click on another page while the refresh runs makes Next discard it and
 * then run a `router.refresh()`, which drops every page loaded for the next
 * click. Next also runs one Server Action at a time, so a button's action
 * would wait for the refresh. So the refresh waits while a link to another
 * page or a button has the pointer or keyboard focus, checking this often,
 * and starts after `MAX_REFRESH_WAIT_MS` at the latest.
 */
export const CONTROL_IN_USE_CHECK_MS = 250;
export const MAX_REFRESH_WAIT_MS = 3_000;

const PREFETCHED_CONTENT_STALE_MS = PREFETCHED_CONTENT_STALE_SECONDS * 1000;

let traversedAt = Number.NEGATIVE_INFINITY;
/**
 * Refreshes still running. An unmarked page that wants one meanwhile came by a
 * navigation, which made Next discard the running one and queue a
 * `router.refresh()` of the page that now shows, so a second is not needed.
 * A stale-marked refresh still queues behind a running one because the running
 * refresh may have started before the mutation finished.
 */
let runningRefreshes = 0;
const stalePages = new Set<string>();
const staleListeners = new Set<(page: string) => void>();

/** Marks a page stale after a browser-side mutation so it refreshes when shown. */
export function markPageStale(page: string): void {
  stalePages.add(page);
  for (const listener of staleListeners) {
    listener(page);
  }
}
// The document load rendered everything fresh.
let refreshedAt = Number.NEGATIVE_INFINITY;
/**
 * When each page first showed since its last refresh. A content prefetch of
 * a page visited in the last 5 minutes (Next's `staleTimes.static`) takes
 * that visit's copy with no request, and each return keeps the same data in
 * it. So any return more than the prefetch stale time after the first visit
 * may open an old copy. A page's query variants share one entry, so the
 * earliest of them counts. A refresh keeps the pages already loaded for the
 * next click, and some of them came from such a copy, so a refresh resets
 * only the page it renders.
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

const CONTROL_IN_USE =
  "a:hover, a:focus-visible, button:hover, button:focus-visible";

/** A link this tab opens as another page, which discards a running refresh. */
function opensAnotherPageHere(link: HTMLAnchorElement): boolean {
  if (link.target === "_blank" || link.hasAttribute("download")) return false;
  const url = new URL(link.href, window.location.href);
  return (
    url.origin === window.location.origin &&
    url.pathname + url.search !==
      window.location.pathname + window.location.search
  );
}

/** A control the reader is about to use while the refresh would run. */
function controlInUse(): boolean {
  return Array.from(document.querySelectorAll(CONTROL_IN_USE)).some(
    (control) =>
      (control instanceof HTMLButtonElement && !control.disabled) ||
      (control instanceof HTMLAnchorElement && opensAnotherPageHere(control)),
  );
}

function refreshNow(
  page: string,
  router: ReturnType<typeof useRouter>,
  options?: { marked?: boolean; onSettled?: () => void },
) {
  const marked = options?.marked ?? false;
  refreshedAt = Date.now();
  traversedAt = Number.NEGATIVE_INFINITY;
  visitedAt.set(page, refreshedAt);
  if (runningRefreshes > 0 && !marked) return;
  runningRefreshes += 1;
  // Full route refresh, by the action's `refresh()` or the client fallback:
  // the kept page holds several private-cached reads, and no single tag or
  // path invalidates only them.
  // The action fails when a deploy replaced it (version skew) or the network
  // drops, and returns false without a session cookie. The client refresh
  // still renders the page (or sends the reader to sign in), at the cost of
  // the pages loaded for the next click.
  refreshPage()
    .then((refreshed) => {
      if (!refreshed) router.refresh();
    })
    .catch(() => router.refresh())
    .finally(() => {
      runningRefreshes -= 1;
      options?.onSettled?.();
    });
}

function subscribeToNothing() {
  return () => {};
}

/**
 * Refreshes a prefetched page when it may show a stale copy, waiting up to
 * `MAX_REFRESH_WAIT_MS` while a navigation link or button is in use.
 */
export function useRefreshPrefetchedPage(everyVisit: boolean): void {
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
    const refresh = shouldRefresh(page, everyVisit) || stalePages.has(page);
    if (!visitedAt.has(page)) visitedAt.set(page, Date.now());

    let check: ReturnType<typeof setInterval> | null = null;
    let pendingMarkedRefreshes = 0;

    const startRefresh = () => {
      const marked = stalePages.delete(page);
      if (marked) {
        pendingMarkedRefreshes += 1;
      }
      refreshNow(page, router, {
        marked,
        onSettled: marked
          ? () => {
              pendingMarkedRefreshes -= 1;
            }
          : undefined,
      });
    };

    const scheduleRefresh = () => {
      if (check !== null) return;
      if (!controlInUse()) {
        startRefresh();
        return;
      }
      const startBy = Date.now() + MAX_REFRESH_WAIT_MS;
      check = setInterval(() => {
        if (controlInUse() && Date.now() < startBy) return;
        if (check !== null) {
          clearInterval(check);
          check = null;
        }
        startRefresh();
      }, CONTROL_IN_USE_CHECK_MS);
    };

    const handlePageStale = (stalePage: string) => {
      if (stalePage !== page) return;
      scheduleRefresh();
    };
    staleListeners.add(handlePageStale);

    if (skipNextRefresh.current) {
      skipNextRefresh.current = false;
    } else if (refresh) {
      scheduleRefresh();
    }

    return () => {
      staleListeners.delete(handlePageStale);
      if (check !== null) {
        clearInterval(check);
        check = null;
      }
      // Re-mark when this page hides before its marked refresh settles so the
      // next reveal still fetches fresh data.
      if (pendingMarkedRefreshes > 0) {
        stalePages.add(page);
      }
    };
  }, [router, everyVisit]);
}
