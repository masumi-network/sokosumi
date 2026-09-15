export const TIME_ZONE_COOKIE_NAME = "sokosumi.timezone";
export const DEFAULT_TIME_ZONE = "UTC";

const TIME_ZONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Zone the request renders dates in. The browser writes its own zone into the
 * cookie ({@link TimeZoneSync}); until then the server falls back to UTC so
 * server and client still agree on the first paint.
 */
export function resolveRequestTimeZone(
  cookieValue: string | undefined,
): string {
  if (cookieValue && isValidTimeZone(cookieValue)) {
    return cookieValue;
  }
  return DEFAULT_TIME_ZONE;
}

export function serializeTimeZoneCookie(timeZone: string): string {
  return `${TIME_ZONE_COOKIE_NAME}=${encodeURIComponent(timeZone)}; path=/; max-age=${TIME_ZONE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
