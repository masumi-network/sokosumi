"use client";

import { useQueryState } from "nuqs";
import { useEffect } from "react";
import { calendarParsers } from "@/app/calendar/calendar-parsers";

/**
 * Defaults a mobile Workspace Calendar URL with no `view` parameter to
 * `"agenda"` (unless locked to Social posts), with `shallow: false` so the
 * server loads agenda data.
 */
export function useCalendarMobileAgendaDefault(
  isMobile: boolean,
  socialOnly: boolean,
): void {
  const [view, setView] = useQueryState("view", calendarParsers.view);

  useEffect(() => {
    if (isMobile && view === null && !socialOnly) {
      void setView("agenda", { shallow: false });
    }
  }, [isMobile, view, setView, socialOnly]);
}
