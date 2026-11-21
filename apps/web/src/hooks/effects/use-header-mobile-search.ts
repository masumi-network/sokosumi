"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { usePathname, useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useRef, useState } from "react";

import { useOptionalHistorySearch } from "@/app/components/history-search-dialog-provider";
import {
  HISTORY_FILTER_PARAM_KEYS,
  HISTORY_SEARCH_MAX_LENGTH,
} from "@/app/history/utils/history-filters";
import { getEnvPublicConfig } from "@/config/env.public";
import { useScheduledTimeout } from "@/hooks/effects/use-scheduled-timeout";

const HISTORY_PATH = "/history";

function isHistoryPath(pathname: string): boolean {
  return pathname === HISTORY_PATH || pathname.endsWith(HISTORY_PATH);
}

function readLocationSearch(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.search;
}

function readHistoryQueryFromLocation(): string {
  return (
    new URLSearchParams(readLocationSearch()).get(
      HISTORY_FILTER_PARAM_KEYS.q,
    ) ?? ""
  );
}

function replaceHistoryQuery(
  router: AppRouterInstance,
  pathname: string,
  nextQuery: string | null,
) {
  const currentPath =
    typeof window !== "undefined" ? window.location.pathname : pathname;
  if (!isHistoryPath(currentPath)) {
    return;
  }

  const paramsForMerge = new URLSearchParams(readLocationSearch());

  if (nextQuery) {
    paramsForMerge.set(HISTORY_FILTER_PARAM_KEYS.q, nextQuery);
  } else {
    paramsForMerge.delete(HISTORY_FILTER_PARAM_KEYS.q);
  }

  const nextQueryString = paramsForMerge.toString();
  router.replace(
    nextQueryString ? `${HISTORY_PATH}?${nextQueryString}` : HISTORY_PATH,
  );
}

/**
 * Coordinates the mobile header search bar with `/history` navigation,
 * debounced `?q=` URL replacement, pending-navigation bounce-back, and
 * route-exit cleanup.
 */
export function useHeaderMobileSearch() {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  // Soft read: the Instant Nav shell mounts before HistorySearchDialogProvider.
  const historySearch = useOptionalHistorySearch();
  const previousPathnameRef = useRef(pathname);
  const navigatedToHistoryRef = useRef(false);
  /** Dismissed before `router.push(/history)` committed — bounce on arrival. */
  const abortPendingHistoryNavigationRef = useRef(false);
  const queryRef = useRef(query);
  queryRef.current = query;

  const replaceHistoryTimeout = useScheduledTimeout();

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;

    if (abortPendingHistoryNavigationRef.current && isHistoryPath(pathname)) {
      abortPendingHistoryNavigationRef.current = false;
      navigatedToHistoryRef.current = false;
      replaceHistoryTimeout.cancel();
      setExpanded(false);
      setQuery("");
      router.back();
      return;
    }

    if (
      expanded &&
      isHistoryPath(previousPathname) &&
      !isHistoryPath(pathname)
    ) {
      replaceHistoryTimeout.cancel();
      navigatedToHistoryRef.current = false;
      abortPendingHistoryNavigationRef.current = false;
      setExpanded(false);
      setQuery("");
      return;
    }

    // Opened search from a non-history route: typing can race `router.push`.
    // Debounced replaces no-op off /history and used to be cancelled on arrival.
    // Flush the local query once navigation lands so `?q=` reaches the URL.
    if (
      expanded &&
      !isHistoryPath(previousPathname) &&
      isHistoryPath(pathname)
    ) {
      replaceHistoryTimeout.cancel();
      const trimmedQuery = queryRef.current.trim();
      if (trimmedQuery) {
        replaceHistoryQuery(router, pathname, trimmedQuery);
      }
    }
  }, [pathname, expanded, replaceHistoryTimeout, router]);

  function openSearch(event: MouseEvent<HTMLButtonElement>) {
    // Same search as the sidebar and ⌘K (Tasks, tags, files). On Credit
    // history itself, Search keeps filtering that page in place.
    if (historySearch && !isHistoryPath(pathname)) {
      historySearch.openHistorySearch(event.currentTarget);
      return;
    }
    setExpanded(true);
    abortPendingHistoryNavigationRef.current = false;
    if (!isHistoryPath(pathname)) {
      setQuery("");
      navigatedToHistoryRef.current = true;
      router.push(HISTORY_PATH);
      return;
    }
    navigatedToHistoryRef.current = false;
    setQuery(readHistoryQueryFromLocation());
  }

  function collapse() {
    replaceHistoryTimeout.cancel();
    const shouldNavigateBack = navigatedToHistoryRef.current;
    const hadQuery =
      query.trim().length > 0 ||
      (isHistoryPath(pathname) && readHistoryQueryFromLocation().length > 0);
    navigatedToHistoryRef.current = false;
    setQuery("");
    setExpanded(false);
    if (shouldNavigateBack) {
      // Only back once /history has committed; otherwise `router.back()` leaves
      // the originating route for whatever was before it.
      if (isHistoryPath(pathname)) {
        abortPendingHistoryNavigationRef.current = false;
        router.back();
      } else {
        abortPendingHistoryNavigationRef.current = true;
      }
      return;
    }
    abortPendingHistoryNavigationRef.current = false;
    if (isHistoryPath(pathname) && hadQuery) {
      replaceHistoryQuery(router, pathname, null);
    }
  }

  function handleInputChange(next: string) {
    const capped = next.slice(0, HISTORY_SEARCH_MAX_LENGTH);
    setQuery(capped);
    const trimmed = capped.trim() || null;
    replaceHistoryTimeout.schedule(
      () => replaceHistoryQuery(router, pathname, trimmed),
      getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
    );
  }

  return {
    expanded,
    query,
    openSearch,
    collapse,
    handleInputChange,
  };
}
