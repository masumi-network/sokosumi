import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/** Hostnames seen in Chrome `Failed to fetch (hostname)` rejection messages. */
const THIRD_PARTY_FETCH_ERROR_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "snap.licdn.com",
  "google-analytics.com",
  "analytics.google.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "connect.facebook.net",
] as const;

/** Stack frame URL patterns for analytics/marketing scripts injected via GTM. */
const THIRD_PARTY_ANALYTICS_URL_PATTERNS = [
  /plausible\.io/i,
  /script\.file-downloads/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /analytics\.google\.com/i,
  /px\.ads\.linkedin\.com/i,
  /snap\.licdn\.com/i,
  /doubleclick\.net/i,
  /connect\.facebook\.net/i,
] as const;

const CHROME_FETCH_HOST_ERROR = /^TypeError: Failed to fetch \(([^)]+)\)$/;

function getExceptionMessage(event: ErrorEvent): string {
  return event.exception?.values?.[0]?.value ?? "";
}

function getStackFrames(event: ErrorEvent) {
  return (
    event.exception?.values?.flatMap(
      (value) => value.stacktrace?.frames ?? [],
    ) ?? []
  );
}

function isKnownThirdPartyFetchHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return THIRD_PARTY_FETCH_ERROR_HOSTS.some(
    (host) => normalized === host || normalized.endsWith(`.${host}`),
  );
}

export function isThirdPartyAnalyticsError(event: ErrorEvent): boolean {
  const message = getExceptionMessage(event);
  const hostMatch = message.match(CHROME_FETCH_HOST_ERROR);
  if (hostMatch && isKnownThirdPartyFetchHost(hostMatch[1])) {
    return true;
  }

  return getStackFrames(event).some((frame) => {
    const filename = frame.filename ?? "";
    return THIRD_PARTY_ANALYTICS_URL_PATTERNS.some((pattern) =>
      pattern.test(filename),
    );
  });
}

export function filterThirdPartyAnalyticsErrors(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  if (isThirdPartyAnalyticsError(event)) {
    return null;
  }

  return event;
}
