import { isValidTimezone } from "@sokosumi/utils";

import { browserCookieFlags } from "@/i18n/locales";

export const TIME_ZONE_COOKIE_NAME = "sokosumi.timezone";
export const DEFAULT_TIME_ZONE = "UTC";

const TIME_ZONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Zone the request renders dates in. The browser writes its own zone into the
 * cookie ({@link TimeZoneSync}); until then the server falls back to UTC so
 * server and client still agree on the first paint.
 */
export function resolveRequestTimeZone(
  cookieValue: string | undefined,
): string {
  if (cookieValue && isValidTimezone(cookieValue)) {
    return cookieValue;
  }
  return DEFAULT_TIME_ZONE;
}

export function serializeTimeZoneCookie(timeZone: string): string {
  return `${TIME_ZONE_COOKIE_NAME}=${encodeURIComponent(timeZone)}; ${browserCookieFlags(TIME_ZONE_COOKIE_MAX_AGE)}`;
}
