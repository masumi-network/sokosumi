import type { ErrorEvent } from "@sentry/nextjs";

const THIRD_PARTY_ANALYTICS_FETCH_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "pagead2.googlesyndication.com",
  "google-analytics.com",
] as const;

const PLAUSIBLE_STACK_MARKERS = [
  "plausible",
  "script.file-downloads.hash.outbound-links",
] as const;

const FAILED_TO_FETCH_WITH_HOST = /^TypeError: Failed to fetch \(([^)]+)\)$/i;

export const thirdPartyAnalyticsFetchIgnorePatterns: RegExp[] = [
  /^TypeError: Failed to fetch \(plausible\.io\)$/i,
  /^TypeError: Failed to fetch \(px\.ads\.linkedin\.com\)$/i,
  /^TypeError: Failed to fetch \(pagead2\.googlesyndication\.com\)$/i,
  /^TypeError: Failed to fetch \(region\d+\.google-analytics\.com\)$/i,
];

function getExceptionMessage(event: ErrorEvent): string {
  const exceptionValue = event.exception?.values?.[0]?.value;
  if (exceptionValue) {
    return exceptionValue;
  }

  if (typeof event.message === "string") {
    return event.message;
  }

  return "";
}

function getStackFrameFilenames(event: ErrorEvent): string[] {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  return frames
    .map((frame) => frame.filename ?? frame.abs_path ?? "")
    .filter((filename) => filename.length > 0);
}

function isThirdPartyAnalyticsHost(host: string): boolean {
  const normalizedHost = host.toLowerCase();

  return THIRD_PARTY_ANALYTICS_FETCH_HOSTS.some(
    (analyticsHost) =>
      normalizedHost === analyticsHost ||
      normalizedHost.endsWith(`.${analyticsHost}`) ||
      normalizedHost.includes(analyticsHost),
  );
}

function hasPlausibleStackFrame(event: ErrorEvent): boolean {
  return getStackFrameFilenames(event).some((filename) =>
    PLAUSIBLE_STACK_MARKERS.some((marker) => filename.includes(marker)),
  );
}

/**
 * Drops client-side noise when GTM-loaded analytics scripts cannot reach their
 * endpoints (ad blockers, privacy extensions, offline users).
 */
export function shouldIgnoreThirdPartyAnalyticsFetchError(
  event: ErrorEvent,
): boolean {
  const message = getExceptionMessage(event);
  const failedFetchWithHost = FAILED_TO_FETCH_WITH_HOST.exec(message);

  if (failedFetchWithHost) {
    return isThirdPartyAnalyticsHost(failedFetchWithHost[1]);
  }

  if (!/failed to fetch/i.test(message)) {
    return false;
  }

  return hasPlausibleStackFrame(event);
}

export function filterThirdPartyAnalyticsFetchError(
  event: ErrorEvent,
): ErrorEvent | null {
  if (shouldIgnoreThirdPartyAnalyticsFetchError(event)) {
    return null;
  }

  return event;
}
