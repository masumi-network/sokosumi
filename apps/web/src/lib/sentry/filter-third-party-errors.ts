import type { ErrorEvent, Event } from "@sentry/nextjs";

/** Hostnames for Sokosumi APIs and the web app — never treat as third-party noise. */
const FIRST_PARTY_HOST_SUFFIXES = ["sokosumi.com", "localhost"] as const;

/**
 * Marketing / analytics / CMP hosts loaded via GTM or script tags. Fetch failures
 * here are usually ad blockers or network issues, not application bugs.
 */
const THIRD_PARTY_ANALYTICS_HOST_SUFFIXES = [
  "px.ads.linkedin.com",
  "plausible.io",
  "pagead2.googlesyndication.com",
  "googlesyndication.com",
  "google-analytics.com",
  "analytics.google.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "usercentrics.eu",
  "licdn.com",
] as const;

const THIRD_PARTY_STACK_PATTERNS = [
  /li\.lms-analytics/i,
  /insight\.old\.min\.js/i,
  /plausible/i,
  /googletagmanager/i,
  /googlesyndication/i,
  /usercentrics/i,
  /frame_ant/i,
  /chrome-extension:/i,
] as const;

const FIRST_PARTY_STACK_PATTERN =
  /(_next\/static|webpack:|turbopack:|[\\/]apps[\\/]web[\\/]|sokosumi)/i;

const FAILED_TO_FETCH_WITH_HOST = /^TypeError: Failed to fetch \(([^)]+)\)$/i;

const FAILED_TO_FETCH_DYNAMIC_IMPORT =
  /^TypeError: Failed to fetch dynamically imported module: https?:\/\/([^/]+)/i;

function isFirstPartyHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return FIRST_PARTY_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

function isThirdPartyAnalyticsHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return THIRD_PARTY_ANALYTICS_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

function getErrorMessage(event: ErrorEvent): string | undefined {
  const value = event.exception?.values?.[0]?.value;
  return typeof value === "string" ? value : undefined;
}

function getStackFrames(event: ErrorEvent): string[] {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return frames
    .map((frame) => [frame.abs_path, frame.filename, frame.module].join(" "))
    .filter(Boolean);
}

function stackIsThirdPartyOnly(stackText: string): boolean {
  if (!stackText.trim()) {
    return false;
  }

  if (FIRST_PARTY_STACK_PATTERN.test(stackText)) {
    return false;
  }

  return THIRD_PARTY_STACK_PATTERNS.some((pattern) => pattern.test(stackText));
}

function getFailedFetchHost(message: string): string | null {
  const withHost = FAILED_TO_FETCH_WITH_HOST.exec(message);
  if (withHost?.[1]) {
    return withHost[1];
  }

  const dynamicImport = FAILED_TO_FETCH_DYNAMIC_IMPORT.exec(message);
  if (dynamicImport?.[1]) {
    return dynamicImport[1];
  }

  return null;
}

/**
 * Returns true when the event is a browser fetch failure from third-party
 * marketing/analytics scripts (e.g. LinkedIn Insight Tag via GTM).
 */
export function isThirdPartyAnalyticsFetchError(event: ErrorEvent): boolean {
  const message = getErrorMessage(event);
  if (!message) {
    return false;
  }

  const failedFetchHost = getFailedFetchHost(message);
  if (failedFetchHost) {
    if (isFirstPartyHost(failedFetchHost)) {
      return false;
    }
    if (isThirdPartyAnalyticsHost(failedFetchHost)) {
      return true;
    }
  }

  if (!message.includes("Failed to fetch")) {
    return false;
  }

  const stackText = getStackFrames(event).join("\n");
  return stackIsThirdPartyOnly(stackText);
}

/** Drop third-party analytics noise in client Sentry `beforeSend`. */
export function beforeSendFilterThirdPartyErrors(event: Event): Event | null {
  if (event.type !== "error") {
    return event;
  }

  if (isThirdPartyAnalyticsFetchError(event)) {
    return null;
  }

  return event;
}
