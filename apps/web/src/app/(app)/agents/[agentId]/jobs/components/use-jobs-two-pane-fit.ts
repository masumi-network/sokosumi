"use client";

import {
  JOBS_PANES_ATTRIBUTE,
  JOBS_TWO_PANE_MIN_WIDTH,
  useJobsTwoPaneFitObserver,
} from "@/hooks/effects/use-jobs-two-pane-fit-observer";

export { JOBS_PANES_ATTRIBUTE, JOBS_TWO_PANE_MIN_WIDTH };

/**
 * Whether the jobs panes row is wide enough to show the list and a detail pane
 * side by side. `null` until the row has been measured.
 *
 * Measures the row rather than the window: the sidebar takes 14rem (expanded)
 * or 3.5rem (rail) out of the width the panes actually get, so a viewport
 * media query answers a different question than the one the layout asks.
 */
export function useJobsTwoPaneFit(): boolean | null {
  return useJobsTwoPaneFitObserver();
}
