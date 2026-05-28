import type { ErrorEvent, EventHint } from "@sentry/core";

/** Hosts loaded via GTM/consent tools whose fetch failures are not app bugs. */
const THIRD_PARTY_FETCH_HOSTS = [
  "px.ads.linkedin.com",
  "snap.licdn.com",
  "plausible.io",
  "www.google-analytics.com",
  "google-analytics.com",
  "www.googletagmanager.com",
  "googletagmanager.com",
  "www.googleadservices.com",
  "googleadservices.com",
  "connect.facebook.net",
  "www.facebook.com",
  "doubleclick.net",
] as const;

/** Stack filename/url substrings for third-party marketing/analytics scripts. */
const THIRD_PARTY_STACK_MARKERS = [
  "li.lms-analytics",
  "insight.old.min.js",
  "plausible.io",
  "googletagmanager.com",
  "google-analytics.com",
  "googleadservices.com",
  "connect.facebook.net",
  "fbevents.js",
  "gtm.js",
] as const;

const FAILED_TO_FETCH_WITH_HOST = /^TypeError: Failed to fetch \(([^)]+)\)$/i;

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

function isKnownThirdPartyHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return THIRD_PARTY_FETCH_HOSTS.some(
    (known) => normalized === known || normalized.endsWith(`.${known}`),
  );
}

function getErrorMessage(event: ErrorEvent): string {
  const exceptionValue = event.exception?.values?.[0]?.value;
  if (typeof exceptionValue === "string" && exceptionValue.length > 0) {
    return exceptionValue;
  }

  if (typeof event.message === "string") {
    return event.message;
  }

  return "";
}

function frameLooksThirdParty(filename: string | undefined): boolean {
  if (!filename) {
    return false;
  }

  return THIRD_PARTY_STACK_MARKERS.some((marker) => filename.includes(marker));
}

function stacktraceIsThirdPartyAnalytics(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  if (frames.length === 0) {
    return false;
  }

  const relevantFrames = frames.filter(
    (frame) => frame.filename && !frame.filename.includes("@sentry"),
  );

  if (relevantFrames.length === 0) {
    return false;
  }

  const hasAppSourceFrame = relevantFrames.some((frame) => {
    const filename = frame.filename ?? "";
    return (
      filename.includes("/src/") ||
      filename.includes("webpack-internal:///(app-pages-browser)/./src/")
    );
  });

  if (hasAppSourceFrame) {
    return false;
  }

  return relevantFrames.every((frame) =>
    frameLooksThirdParty(frame.filename ?? frame.abs_path),
  );
}

/**
 * Returns true when a browser "Failed to fetch" rejection comes from marketing /
 * analytics pixels (GTM tags), not from Sokosumi application code.
 */
export function shouldIgnoreThirdPartyFetchError(
  event: ErrorEvent,
  _hint?: EventHint,
): boolean {
  const message = getErrorMessage(event);
  if (!/failed to fetch/i.test(message)) {
    return false;
  }

  const hostMatch = message.match(FAILED_TO_FETCH_WITH_HOST);
  if (hostMatch?.[1] && isKnownThirdPartyHost(hostMatch[1])) {
    return true;
  }

  return stacktraceIsThirdPartyAnalytics(event);
}

export const thirdPartyFetchIgnoreErrors: Array<string | RegExp> = [
  /Failed to fetch \(px\.ads\.linkedin\.com\)/i,
  /Failed to fetch \(plausible\.io\)/i,
  /Failed to fetch \(www\.google-analytics\.com\)/i,
  /Failed to fetch \(www\.googletagmanager\.com\)/i,
];

export const thirdPartyScriptDenyUrls: Array<string | RegExp> = [
  /px\.ads\.linkedin\.com/i,
  /snap\.licdn\.com/i,
  /li\.lms-analytics/i,
  /plausible\.io/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /googleadservices\.com/i,
  /connect\.facebook\.net/i,
  /doubleclick\.net/i,
];

export function filterThirdPartyFetchError(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  if (shouldIgnoreThirdPartyFetchError(event, hint)) {
    return null;
  }

  return event;
}
