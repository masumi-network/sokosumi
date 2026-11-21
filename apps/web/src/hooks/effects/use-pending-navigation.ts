"use client";

import { useEffect, useOptimistic } from "react";
import { listenForNavigationStart } from "@/lib/navigation/navigation-start";

export interface PendingNavigation {
  pathname: string;
  onScreen: boolean;
}

/**
 * Tracks the destination of an in-flight Next.js navigation inside its own
 * transition so React drops the pending state automatically on arrival.
 */
export function usePendingNavigation(): PendingNavigation | null {
  // Set inside the navigation's transition, so React drops it on arrival. A
  // hard navigation the reader cancels at a "Leave site?" prompt never
  // arrives: the bar and the row mark then stay until the next navigation
  // does.
  const [pending, setPending] = useOptimistic<PendingNavigation | null>(null);

  useEffect(
    () =>
      listenForNavigationStart((pathname, onScreen) =>
        setPending({ pathname, onScreen }),
      ),
    [],
  );

  return pending;
}
