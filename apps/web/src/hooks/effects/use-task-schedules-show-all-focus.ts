"use client";

import { type RefObject, useEffect } from "react";

/**
 * Where a "Show all schedules" click is headed. The button unmounts with the
 * empty state and the new filter remounts this view (the page keys it by
 * filter), so the request to land on the All tab outlives the instance that
 * made it. Only a view mounted at this URL uses it; every mount, any other
 * filter change and leaving for another URL drop it, so a stale request never
 * moves focus (focusing a Radix tab selects it).
 */
let showAllDestination: string | null = null;

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export interface UseTaskSchedulesShowAllFocusResult {
  armShowAllFocus: (href: string) => void;
  clearShowAllFocus: () => void;
}

/**
 * Moves focus to the All tab when `TaskSchedulesView` remounts at the URL
 * armed by a "Show all schedules" click, and drops stale requests on unmount.
 */
export function useTaskSchedulesShowAllFocus(
  allTabRef: RefObject<HTMLButtonElement | null>,
): UseTaskSchedulesShowAllFocusResult {
  useEffect(() => {
    const arrived = showAllDestination === currentUrl();
    showAllDestination = null;
    if (arrived) allTabRef.current?.focus();
    return () => {
      // Unmounted for anything but the Show all landing: drop the request.
      if (showAllDestination !== currentUrl()) showAllDestination = null;
    };
  }, []);

  return {
    armShowAllFocus: (href: string) => {
      showAllDestination = href;
    },
    clearShowAllFocus: () => {
      showAllDestination = null;
    },
  };
}
