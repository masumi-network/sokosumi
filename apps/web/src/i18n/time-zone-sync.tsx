"use client";

import { useRouter } from "next/navigation";
import { useTimeZone } from "next-intl";
import { useEffect } from "react";

import {
  serializeTimeZoneCookie,
  TIME_ZONE_COOKIE_NAME,
} from "@/i18n/time-zone";
import { getDefaultTimezone } from "@/lib/schedules/timezones";

/**
 * Keeps the server-side render zone in step with the browser's. The first
 * request has no zone cookie and renders in UTC; once mounted, the browser
 * records its zone and refreshes so server output switches to local time.
 */
export function TimeZoneSync() {
  const router = useRouter();
  const renderedTimeZone = useTimeZone();

  useEffect(() => {
    const browserTimeZone = getDefaultTimezone();
    if (browserTimeZone === renderedTimeZone) {
      return;
    }
    document.cookie = serializeTimeZoneCookie(browserTimeZone);
    const cookieStuck = document.cookie
      .split("; ")
      .some((part) => part.startsWith(`${TIME_ZONE_COOKIE_NAME}=`));
    if (!cookieStuck) {
      return;
    }
    router.refresh();
  }, [renderedTimeZone, router]);

  return null;
}
