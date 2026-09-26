import {
  cookieDomainSuffix,
  cookieSecureSuffix,
} from "@/lib/analytics/consent";

/**
 * Team members opt their browser out of Google tags with `?internal=1` on any
 * sokosumi.com or app.sokosumi.com URL (`?internal=0` opts back in). The
 * marketing site (sokosumi-landing) writes the same cookie on `.sokosumi.com`,
 * so either domain sets it for both. Vercel Analytics is not affected.
 */
export const INTERNAL_TRAFFIC_COOKIE = "sokosumi_internal";
export const INTERNAL_TRAFFIC_PARAM = "internal";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isInternalTraffic(): boolean {
  if (typeof document === "undefined") return false;
  return new RegExp(`(?:^|; )${INTERNAL_TRAFFIC_COOKIE}=1(?:;|$)`).test(
    document.cookie,
  );
}

function writeInternalTrafficCookie(value: "1" | "", maxAgeSeconds: number) {
  document.cookie = `${INTERNAL_TRAFFIC_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${cookieDomainSuffix()}${cookieSecureSuffix()}`;
}

/** Applies `?internal=1|0` from `search`, then reports whether the browser is internal. */
export function syncInternalTraffic(search: string): boolean {
  if (typeof document === "undefined") return false;
  const flag = new URLSearchParams(search).get(INTERNAL_TRAFFIC_PARAM);
  if (flag === "1") {
    writeInternalTrafficCookie("1", MAX_AGE_SECONDS);
  } else if (flag === "0") {
    writeInternalTrafficCookie("", 0);
  }
  return isInternalTraffic();
}

/** `href` without the `internal` param, or null when it has none. */
export function withoutInternalTrafficParam(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(INTERNAL_TRAFFIC_PARAM)) return null;
  url.searchParams.delete(INTERNAL_TRAFFIC_PARAM);
  return url.pathname + url.search + url.hash;
}
