"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  serializeTimeZoneCookie,
  TIME_ZONE_COOKIE_NAME,
} from "@/i18n/time-zone";
import { getDefaultTimezone } from "@/lib/schedules/timezones";

function readTimeZoneCookie(documentCookie: string): string | null {
  for (const part of documentCookie.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${TIME_ZONE_COOKIE_NAME}=`)) continue;
    const raw = trimmed.slice(TIME_ZONE_COOKIE_NAME.length + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Writes the browser's IANA time zone to a cookie when it differs from
 * `renderedTimeZone` and the stored cookie, then refreshes the route only if
 * the written cookie stuck with the detected zone.
 */
export function useBrowserTimeZoneSync(
  renderedTimeZone: string | undefined,
): void {
  const router = useRouter();

  useEffect(() => {
    const browserTimeZone = getDefaultTimezone();
    if (browserTimeZone === renderedTimeZone) {
      return;
    }
    if (readTimeZoneCookie(document.cookie) === browserTimeZone) {
      return;
    }
    document.cookie = serializeTimeZoneCookie(browserTimeZone);
    if (readTimeZoneCookie(document.cookie) !== browserTimeZone) {
      return;
    }
    router.refresh();
  }, [renderedTimeZone, router]);
}
