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

export function beforeSendClientEvent(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  if (isThirdPartyAnalyticsFetchFailure(getEventErrorMessage(event))) {
    return null;
  }

  return event;
}
