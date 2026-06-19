import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/** Hostnames for marketing/analytics scripts loaded via GTM or similar. */
const THIRD_PARTY_ANALYTICS_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "www.google-analytics.com",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
] as const;

/** Script URL substrings used by common third-party trackers (denyUrls). */
export const thirdPartyAnalyticsDenyUrls: RegExp[] = [
  /plausible\.io/i,
  /px\.ads\.linkedin\.com/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /doubleclick\.net/i,
];

/**
 * Tags injected by GTM call `window.clarity(...)` before the Clarity snippet
 * loads (or when it is blocked), throwing from gtm.js — never from our code
 * (see SOKOSUMI-CD, SOKOSUMI-6W). Message shape differs per engine:
 * Chromium/Firefox report `window.clarity is not a function`, WebKit appends
 * `. (In 'window.clarity(...)', 'window.clarity' is undefined)`.
 */
export const thirdPartyAnalyticsIgnoreErrors: RegExp[] = [
  /window\.clarity is not a function/,
];

// Sentry stores the exception type separately, so the value usually arrives
// without the `TypeError: ` prefix; accept both shapes.
const thirdPartyFetchFailurePattern =
  /^(?:TypeError: )?Failed to fetch \(([^)]+)\)$/;

/** WebKit reports blocked or offline network calls as `Load failed (hostname)`. */
const transientFetchFailurePattern =
  /^(?:TypeError: )?(?:Failed to fetch|Load failed) \(([^)]+)\)$/;

/** Core API hosts where client-side connectivity blips are user/network noise. */
const FIRST_PARTY_API_HOSTS = [
  "api.sokosumi.com",
  "api.preprod.sokosumi.com",
] as const;

function getEventErrorMessage(event: ErrorEvent): string {
  const exceptionValue = event.exception?.values?.[0]?.value;
  if (typeof exceptionValue === "string" && exceptionValue.length > 0) {
    return exceptionValue;
  }

  if (typeof event.message === "string") {
    return event.message;
  }

  return "";
}

function isKnownThirdPartyHost(host: string): boolean {
  const normalizedHost = host.toLowerCase();

  return THIRD_PARTY_ANALYTICS_HOSTS.some((knownHost) => {
    return (
      normalizedHost === knownHost || normalizedHost.endsWith(`.${knownHost}`)
    );
  });
}

/** Chrome reports blocked third-party network calls as `Failed to fetch (hostname)`. */
export function isThirdPartyAnalyticsFetchFailure(message: string): boolean {
  const match = message.match(thirdPartyFetchFailurePattern);
  if (!match) {
    return false;
  }

  return isKnownThirdPartyHost(match[1]);
}

function isKnownFirstPartyApiHost(host: string): boolean {
  const normalizedHost = host.toLowerCase();

  return FIRST_PARTY_API_HOSTS.some((knownHost) => {
    return (
      normalizedHost === knownHost || normalizedHost.endsWith(`.${knownHost}`)
    );
  });
}

/**
 * Mobile Safari and other WebKit engines surface offline/tab-background fetch
 * failures as `Load failed (api.sokosumi.com)` instead of Chromium's
 * `Failed to fetch (...)` (see SOKOSUMI-6H on `/signin`).
 */
export function isTransientFirstPartyApiFetchFailure(message: string): boolean {
  const match = message.match(transientFetchFailurePattern);
  if (!match) {
    return false;
  }

  return isKnownFirstPartyApiHost(match[1]);
}

export function beforeSendClientEvent(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  const message = getEventErrorMessage(event);

  if (
    isThirdPartyAnalyticsFetchFailure(message) ||
    isTransientFirstPartyApiFetchFailure(message)
  ) {
    return null;
  }

  return event;
}
