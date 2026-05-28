import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Hostnames for marketing/analytics scripts loaded via GTM or CMP.
 * Fetch failures here are usually ad blockers or network issues, not app bugs.
 */
const THIRD_PARTY_ANALYTICS_HOSTS = [
  "plausible.io",
  "google-analytics.com",
  "analytics.google.com",
  "googletagmanager.com",
  "googlesyndication.com",
  "doubleclick.net",
  "googleadservices.com",
  "usercentrics.eu",
  "web.cmp.usercentrics.eu",
  "vercel-insights.com",
] as const;

const THIRD_PARTY_ANALYTICS_FETCH_MESSAGE =
  /^TypeError: Failed to fetch \(([^)]+)\)$/i;

const USERCENTRICS_DYNAMIC_IMPORT_MESSAGE =
  /failed to fetch dynamically imported module:.*usercentrics/i;

export const thirdPartyAnalyticsDenyUrls: RegExp[] =
  THIRD_PARTY_ANALYTICS_HOSTS.map(
    (host) => new RegExp(host.replace(/\./g, "\\."), "i"),
  );

export const thirdPartyAnalyticsIgnoreErrors: RegExp[] = [
  /Failed to fetch \(plausible\.io\)/i,
  /Failed to fetch \(.*google-analytics\.com\)/i,
  /Failed to fetch \(analytics\.google\.com\)/i,
  /Failed to fetch \(.*googletagmanager\.com\)/i,
  /Failed to fetch \(.*googlesyndication\.com\)/i,
  /Failed to fetch \(.*usercentrics\.eu\)/i,
  /Failed to fetch dynamically imported module:.*usercentrics/i,
];

function getErrorMessage(event: ErrorEvent, hint?: EventHint): string {
  const fromException = event.exception?.values?.[0]?.value;
  if (typeof fromException === "string" && fromException.length > 0) {
    return fromException;
  }

  const original = hint?.originalException;
  if (original instanceof Error && original.message) {
    return original.message;
  }

  if (typeof original === "string") {
    return original;
  }

  return event.message ?? "";
}

function isThirdPartyAnalyticsHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return THIRD_PARTY_ANALYTICS_HOSTS.some(
    (allowedHost) =>
      normalized === allowedHost || normalized.endsWith(`.${allowedHost}`),
  );
}

export function isThirdPartyAnalyticsFetchMessage(message: string): boolean {
  const match = THIRD_PARTY_ANALYTICS_FETCH_MESSAGE.exec(message);
  if (!match?.[1]) {
    return false;
  }

  return isThirdPartyAnalyticsHost(match[1]);
}

export function shouldIgnoreClientError(
  event: ErrorEvent,
  hint?: EventHint,
): boolean {
  const message = getErrorMessage(event, hint);

  if (isThirdPartyAnalyticsFetchMessage(message)) {
    return true;
  }

  if (USERCENTRICS_DYNAMIC_IMPORT_MESSAGE.test(message)) {
    return true;
  }

  return false;
}

export function beforeSendClientError(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  return shouldIgnoreClientError(event, hint) ? null : event;
}
