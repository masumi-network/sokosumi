"use client";

import { useTimeZone } from "next-intl";

import { useBrowserTimeZoneSync } from "@/hooks/effects/use-browser-time-zone-sync";

/**
 * Keeps the server-side render zone in step with the browser's. The first
 * request has no zone cookie and renders in UTC; once mounted, the browser
 * records its zone and refreshes so server output switches to local time.
 */
export function TimeZoneSync() {
  const renderedTimeZone = useTimeZone();

  useBrowserTimeZoneSync(renderedTimeZone);

  return null;
}
