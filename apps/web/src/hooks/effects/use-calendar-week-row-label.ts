"use client";

import { useEffect } from "react";

/**
 * Sets `aria-label` on a FullCalendar month week row element to the localized
 * ISO week number label.
 */
export function useCalendarWeekRowLabel(
  row: HTMLElement | null | undefined,
  label: string | null,
): void {
  useEffect(() => {
    if (row && label) row.setAttribute("aria-label", label);
  }, [row, label]);
}
