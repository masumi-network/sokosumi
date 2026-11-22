"use client";

import { useEffect, useState } from "react";

/**
 * Measures the `[data-jobs-panes]` row via `ResizeObserver` for
 * `useJobsTwoPaneFit` and returns whether its width meets `minWidth` (or
 * `null` until measured).
 */
export function useJobsTwoPaneFitObserver(
  panesAttribute: string,
  minWidth: number,
): boolean | null {
  const [fits, setFits] = useState<boolean | null>(null);

  // Effect is necessary: subscribes to an external system (element geometry).
  useEffect(() => {
    // Both callers render inside the jobs layout, which commits the row in the
    // same pass, so the row is present by the time this effect runs.
    const row = document.querySelector(`[${panesAttribute}]`);
    if (!row) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setFits(entry.contentRect.width >= minWidth);
    });

    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return fits;
}
