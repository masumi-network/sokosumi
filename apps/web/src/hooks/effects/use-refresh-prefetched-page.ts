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
interface PageStaleState {
  version: number;
  resolvedVersion: number;
  ackedVersion: number;
}
const staleStateByPage = new Map<string, PageStaleState>();
const staleListeners = new Set<(page: string) => void>();

function isPageStale(page: string): boolean {
  const state = staleStateByPage.get(page);
  return state !== undefined && state.version > state.ackedVersion;
}

/**
 * Marks a page stale after a browser-side mutation so it refreshes when shown.
 * The mark stays active until a post-mark refresh resolves on the page and the
 * page commits a new server snapshot via `acknowledgePageSnapshot(page)`.
 */
export function markPageStale(page: string): void {
  const current = staleStateByPage.get(page);
  if (current) {
    current.version += 1;
  } else {
    staleStateByPage.set(page, {
      version: 1,
      resolvedVersion: 0,
      ackedVersion: 0,
    });
  }
  for (const listener of staleListeners) {
    listener(page);
  }
}

/**
 * Acknowledges that a new server snapshot committed on `page`. Clears the stale
 * mark only when a post-mark refresh has already resolved on `page`, so neither
 * a pre-mutation refresh nor a discarded action tree drops the mark.
 */
export function acknowledgePageSnapshot(page: string): void {
  const state = staleStateByPage.get(page);
  if (!state || state.resolvedVersion <= state.ackedVersion) return;
  state.ackedVersion = state.resolvedVersion;
  if (state.ackedVersion >= state.version) {
    staleStateByPage.delete(page);
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
  options?: { marked?: boolean; onResolved?: () => void },
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
      if (!refreshed) {
        if (window.location.pathname === page) {
          router.refresh();
          options?.onResolved?.();
        }
        return;
      }
      options?.onResolved?.();
    })
    .catch(() => {
      if (window.location.pathname === page) {
        router.refresh();
        options?.onResolved?.();
      }
    })
    .finally(() => {
      runningRefreshes -= 1;
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
    const refresh = shouldRefresh(page, everyVisit) || isPageStale(page);
    if (!visitedAt.has(page)) visitedAt.set(page, Date.now());

    let active = true;
    let check: ReturnType<typeof setInterval> | null = null;

    const startRefresh = () => {
      const staleState = staleStateByPage.get(page);
      const markedVersion =
        staleState && staleState.version > staleState.ackedVersion
          ? staleState.version
          : 0;
      refreshNow(page, router, {
        marked: markedVersion > 0,
        onResolved:
          markedVersion > 0
            ? () => {
                if (!active || window.location.pathname !== page) return;
                const state = staleStateByPage.get(page);
                if (state && markedVersion > state.resolvedVersion) {
                  state.resolvedVersion = markedVersion;
                }
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
      active = false;
      staleListeners.delete(handlePageStale);
      if (check !== null) {
        clearInterval(check);
        check = null;
      }
      // If a refresh resolved while shown without its snapshot committing
      // (e.g. Next discarded its tree), drop the unacknowledged resolution so
      // only a post-return refresh can clear the mark.
      const state = staleStateByPage.get(page);
      if (state && state.resolvedVersion > state.ackedVersion) {
        state.resolvedVersion = state.ackedVersion;
      }
    };
  }, [router, everyVisit]);
}
