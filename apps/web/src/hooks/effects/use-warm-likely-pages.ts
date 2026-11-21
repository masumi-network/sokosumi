"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";

import { likelyPages, readVisitCounts } from "@/lib/navigation/likely-pages";
import { prefetchRouteContent } from "@/lib/navigation/prefetch-route-content";

/**
 * How often the loop asks for the likely pages. A page still fresh in the
 * router's cache costs nothing; an expired or dropped one renders once, or
 * takes the copy of a visit in the last 5 minutes. So this also caps the renders a burst of refreshes (a busy board's live
 * updates) can start, at one per page per interval.
 */
export const WARM_INTERVAL_MS = 10_000;

/** A tab whose reader did nothing for this long stops loading pages. */
export const ACTIVE_WINDOW_MS = 5 * 60_000;

/** How long the first load waits for the browser to go idle. */
const FIRST_WARM_TIMEOUT_MS = 2_000;

const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
] as const;

/**
 * Keeps the reader's most visited pages loaded while they use the tab, so a
 * click on one opens it with its content even when no hover or approach
 * predicted it.
 */
export function useWarmLikelyPages(hrefFor: (href: string) => string): void {
  const router = useRouter();
  // The sidebar links carry the reader's project scope, so the loop loads
  // the same URLs a click opens. The loop starts once and reads the latest.
  const resolveHref = useEffectEvent(hrefFor);

  useEffect(() => {
    let lastActivityAt = Date.now();
    const markActive = () => {
      lastActivityAt = Date.now();
    };

    const warm = () => {
      if (document.hidden) return;
      if (Date.now() - lastActivityAt > ACTIVE_WINDOW_MS) return;
      for (const href of likelyPages(
        readVisitCounts(),
        window.location.pathname,
      )) {
        prefetchRouteContent(router, resolveHref(href));
      }
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }
    const interval = window.setInterval(warm, WARM_INTERVAL_MS);
    // The page the reader opened loads first; the likely pages wait for idle.
    const cancelFirstWarm =
      typeof window.requestIdleCallback === "function"
        ? (() => {
            const handle = window.requestIdleCallback(warm, {
              timeout: FIRST_WARM_TIMEOUT_MS,
            });
            return () => window.cancelIdleCallback(handle);
          })()
        : (() => {
            const timeout = window.setTimeout(warm, FIRST_WARM_TIMEOUT_MS);
            return () => window.clearTimeout(timeout);
          })();

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
      window.clearInterval(interval);
      cancelFirstWarm();
    };
  }, []);
}
