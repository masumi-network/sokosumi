"use client";

import { useEffect, useState } from "react";
import { MOBILE_BREAKPOINT } from "@/hooks/effects/use-mobile";

/** Desktop app chrome reserves a left sidebar; align to that column, not the viewport. */
export function mainChromeLeftPx(
  viewportWidth: number,
  sidebarGapWidth: number | null,
): number {
  if (viewportWidth < MOBILE_BREAKPOINT) return 0;
  return sidebarGapWidth ?? 0;
}

/**
 * Tracks the desktop sidebar gap width for `CookieBanner` via `ResizeObserver`
 * and `window` `resize` so the fixed banner aligns to the main content column.
 */
export function useCookieBannerChromeLeftPx(): number {
  const [leftPx, setLeftPx] = useState(0);

  useEffect(() => {
    let observer: ResizeObserver | undefined;

    function measure() {
      const gap = document.querySelector<HTMLElement>(
        "[data-slot=sidebar-gap]",
      );
      setLeftPx(
        mainChromeLeftPx(
          window.innerWidth,
          gap?.getBoundingClientRect().width ?? null,
        ),
      );
    }

    measure();
    const gap = document.querySelector("[data-slot=sidebar-gap]");
    if (gap) {
      observer = new ResizeObserver(measure);
      observer.observe(gap);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return leftPx;
}
