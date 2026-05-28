import type { ErrorEvent } from "@sentry/nextjs";

const THIRD_PARTY_FETCH_FAILURE = /^Failed to fetch \(([^)]+)\)$/;

/**
 * Marketing/analytics hosts loaded via GTM that commonly fail when blocked by
 * ad blockers, privacy extensions, or consent settings.
 */
const THIRD_PARTY_ANALYTICS_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "snap.licdn.com",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "connect.facebook.net",
] as const;

/**
 * Script URL patterns for third-party analytics and browser extensions that
 * should not create Sentry noise.
 */
export const sentryDeniedUrlPatterns: Array<string | RegExp> = [
  /\/li\.lms-analytics\//,
  /plausible\.io/,
  /googletagmanager\.com/,
  /google-analytics\.com/,
  /frame_ant\//,
  /injectScriptAdjust/,
  /^chrome-extension:\/\//,
  /^moz-extension:\/\//,
  /^safari-extension:\/\//,
];

export const sentryIgnoredErrorPatterns: Array<string | RegExp> = [
  /^Failed to fetch \(plausible\.io\)$/,
  /^Failed to fetch \(px\.ads\.linkedin\.com\)$/,
];

function isThirdPartyAnalyticsHost(host: string): boolean {
  const normalizedHost = host.toLowerCase();
  return THIRD_PARTY_ANALYTICS_HOSTS.some((knownHost) =>
    normalizedHost.includes(knownHost),
  );
}

/**
 * Drop client-side fetch failures from third-party analytics scripts. These are
 * not actionable application errors and are commonly caused by ad blockers.
 */
export function shouldDropThirdPartyAnalyticsError(event: ErrorEvent): boolean {
  const value = event.exception?.values?.[0]?.value ?? event.message;
  if (typeof value !== "string") {
    return false;
  }

  const match = value.match(THIRD_PARTY_FETCH_FAILURE);
  if (!match) {
    return false;
  }

  return isThirdPartyAnalyticsHost(match[1]);
}

export function beforeSendClientEvent(event: ErrorEvent): ErrorEvent | null {
  if (shouldDropThirdPartyAnalyticsError(event)) {
    return null;
  }

  return event;
}
