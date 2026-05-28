import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Hostnames for marketing / analytics scripts loaded via GTM or similar.
 * Fetch failures here are usually ad blockers, consent defaults, or network
 * issues outside our control — not Sokosumi application bugs.
 */
const THIRD_PARTY_MARKETING_FETCH_HOSTS = [
  "px.ads.linkedin.com",
  "plausible.io",
  "pagead2.googlesyndication.com",
  "region1.google-analytics.com",
  "analytics.google.com",
  "www.google.com",
  "www.googletagmanager.com",
] as const;

const FAILED_TO_FETCH_HOST_PATTERN = /^TypeError: Failed to fetch \(([^)]+)\)$/;

const USERCENTRICS_DYNAMIC_IMPORT_PATTERN =
  /Failed to fetch dynamically imported module: https:\/\/web\.cmp\.usercentrics\.eu\//;

function getErrorMessage(event: ErrorEvent, hint: EventHint): string {
  const exceptionValue = event.exception?.values?.[0]?.value;
  if (typeof exceptionValue === "string" && exceptionValue.length > 0) {
    return exceptionValue;
  }

  const originalException = hint.originalException;
  if (originalException instanceof Error && originalException.message) {
    return originalException.message;
  }

  if (typeof event.message === "string") {
    return event.message;
  }

  return "";
}

function isThirdPartyMarketingFetchMessage(message: string): boolean {
  const hostMatch = message.match(FAILED_TO_FETCH_HOST_PATTERN);
  if (!hostMatch) {
    return false;
  }

  const host = hostMatch[1].toLowerCase();
  return THIRD_PARTY_MARKETING_FETCH_HOSTS.some(
    (marketingHost) =>
      host === marketingHost || host.endsWith(`.${marketingHost}`),
  );
}

/**
 * Returns true when a browser error should be dropped before sending to Sentry.
 */
export function shouldIgnoreClientError(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  const message = getErrorMessage(event, hint);

  if (!message) {
    return false;
  }

  if (isThirdPartyMarketingFetchMessage(message)) {
    return true;
  }

  if (USERCENTRICS_DYNAMIC_IMPORT_PATTERN.test(message)) {
    return true;
  }

  return false;
}
