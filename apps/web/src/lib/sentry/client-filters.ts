import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const APP_FETCH_HOSTS = [
  "app.sokosumi.com",
  "api.sokosumi.com",
  "preprod.sokosumi.com",
] as const;

const KNOWN_THIRD_PARTY_FETCH_HOSTS = [
  "px.ads.linkedin.com",
  "plausible.io",
  "pagead2.googlesyndication.com",
  "region1.google-analytics.com",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
] as const;

const THIRD_PARTY_STACK_FRAME_PATTERNS = [
  /li\.lms-analytics/i,
  /plausible\.io/i,
  /googletagmanager\.com/i,
] as const;

const FAILED_TO_FETCH_WITH_HOST = /^TypeError: Failed to fetch \(([^)]+)\)$/;

const USERCENTRICS_DYNAMIC_IMPORT =
  /^TypeError: Failed to fetch dynamically imported module: https:\/\/web\.cmp\.usercentrics\.eu\//;

export const THIRD_PARTY_ANALYTICS_IGNORE_ERRORS = [
  /^TypeError: Failed to fetch \(px\.ads\.linkedin\.com\)$/,
  /^TypeError: Failed to fetch \(plausible\.io\)$/,
  /^TypeError: Failed to fetch \(pagead2\.googlesyndication\.com\)$/,
  /^TypeError: Failed to fetch \(region1\.google-analytics\.com\)$/,
  USERCENTRICS_DYNAMIC_IMPORT,
] as const;

function isAppFetchHost(host: string): boolean {
  return APP_FETCH_HOSTS.some((appHost) => host.includes(appHost));
}

function isKnownThirdPartyFetchHost(host: string): boolean {
  return KNOWN_THIRD_PARTY_FETCH_HOSTS.some((thirdPartyHost) =>
    host.includes(thirdPartyHost),
  );
}

function hasThirdPartyAnalyticsStackFrame(event: ErrorEvent): boolean {
  const frames =
    event.exception?.values?.flatMap(
      (exception) => exception.stacktrace?.frames ?? [],
    ) ?? [];

  return frames.some((frame) =>
    THIRD_PARTY_STACK_FRAME_PATTERNS.some((pattern) =>
      pattern.test(frame.filename ?? ""),
    ),
  );
}

export function shouldDropThirdPartyAnalyticsEvent(event: ErrorEvent): boolean {
  const messages = [event.exception?.values?.[0]?.value, event.message].filter(
    (message): message is string => typeof message === "string",
  );

  for (const message of messages) {
    const fetchHostMatch = message.match(FAILED_TO_FETCH_WITH_HOST);
    if (fetchHostMatch) {
      const host = fetchHostMatch[1];
      if (isAppFetchHost(host)) {
        return false;
      }
      if (isKnownThirdPartyFetchHost(host)) {
        return true;
      }
    }

    if (USERCENTRICS_DYNAMIC_IMPORT.test(message)) {
      return true;
    }
  }

  const primaryMessage = event.exception?.values?.[0]?.value ?? event.message;
  if (
    typeof primaryMessage === "string" &&
    primaryMessage.includes("Failed to fetch") &&
    hasThirdPartyAnalyticsStackFrame(event)
  ) {
    return true;
  }

  return false;
}

export function beforeSendClientEvent(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  if (shouldDropThirdPartyAnalyticsEvent(event)) {
    return null;
  }

  return event;
}
