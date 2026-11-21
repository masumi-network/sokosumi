"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  serializeTimeZoneCookie,
  TIME_ZONE_COOKIE_NAME,
} from "@/i18n/time-zone";
import { getDefaultTimezone } from "@/lib/schedules/timezones";

/**
 * Writes the browser's IANA time zone to a cookie when it differs from
 * `renderedTimeZone`, then refreshes the route if the cookie write stuck.
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
    document.cookie = serializeTimeZoneCookie(browserTimeZone);
    const cookieStuck = document.cookie
      .split("; ")
      .some((part) => part.startsWith(`${TIME_ZONE_COOKIE_NAME}=`));
    if (!cookieStuck) {
      return;
    }
    router.refresh();
  }, [renderedTimeZone, router]);
}
