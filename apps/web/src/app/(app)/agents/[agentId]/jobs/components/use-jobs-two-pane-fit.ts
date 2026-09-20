"use client";

import { useEffect, useState } from "react";

/**
 * Narrowest panes row that still leaves the detail pane readable:
 * 18rem list + 1rem gap + 2rem of gutters + 33rem detail.
 *
 * Keep in step with the `@4xl/jobs-panes` variants in the jobs layout — 56rem
 * is that variant's width. `jobs-two-pane-fit.test.ts` asserts the pair.
 */
export const JOBS_TWO_PANE_MIN_WIDTH = 896;

/** Attribute on the panes row, so the measurement and the container query read one box. */
export const JOBS_PANES_ATTRIBUTE = "data-jobs-panes";

/**
 * Whether the jobs panes row is wide enough to show the list and a detail pane
 * side by side. `null` until the row has been measured.
 *
 * Measures the row rather than the window: the sidebar takes 14rem (expanded)
 * or 3.5rem (rail) out of the width the panes actually get, so a viewport
 * media query answers a different question than the one the layout asks.
 */
export function useJobsTwoPaneFit(): boolean | null {
  const [fits, setFits] = useState<boolean | null>(null);

  // Effect is necessary: subscribes to an external system (element geometry).
  useEffect(() => {
    // Both callers render inside the jobs layout, which commits the row in the
    // same pass, so the row is present by the time this effect runs.
    const row = document.querySelector(`[${JOBS_PANES_ATTRIBUTE}]`);
    if (!row) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setFits(entry.contentRect.width >= JOBS_TWO_PANE_MIN_WIDTH);
    });

    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return fits;
}
