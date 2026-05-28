import type { Event, Exception, StackFrame } from "@sentry/core";

/** Hostnames for Sokosumi APIs and the web app — never drop these fetch failures. */
const FIRST_PARTY_HOST_PATTERNS = [
  /^app\.sokosumi\.com$/i,
  /^api\.sokosumi\.com$/i,
  /^sokosumi\.com$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/i,
];

/**
 * Analytics, ads, and consent scripts loaded via GTM / layout tags.
 * Their network failures are expected when blocked and are not app bugs.
 */
const KNOWN_THIRD_PARTY_HOST_PATTERNS = [
  /plausible\.io$/i,
  /linkedin\.com$/i,
  /px\.ads\.linkedin\.com$/i,
  /googlesyndication\.com$/i,
  /google-analytics\.com$/i,
  /googletagmanager\.com$/i,
  /doubleclick\.net$/i,
  /usercentrics\.eu$/i,
  /facebook\.com$/i,
  /connect\.facebook\.net$/i,
  /hotjar\.com$/i,
  /clarity\.ms$/i,
];

const FAILED_TO_FETCH_WITH_HOST = /^TypeError: Failed to fetch \(([^)]+)\)$/;

const FAILED_TO_FETCH_DYNAMIC_IMPORT =
  /^TypeError: Failed to fetch dynamically imported module:/;

function getPrimaryException(event: Event): Exception | undefined {
  return event.exception?.values?.[0];
}

function getErrorMessage(event: Event): string {
  const exception = getPrimaryException(event);
  return exception?.value ?? event.message ?? "";
}

function isFirstPartyHost(host: string): boolean {
  return FIRST_PARTY_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

function isKnownThirdPartyHost(host: string): boolean {
  return KNOWN_THIRD_PARTY_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

function isSokosumiApplicationFrame(frame: StackFrame): boolean {
  const filename = frame.filename ?? frame.abs_path ?? "";
  if (!filename) {
    return false;
  }

  return (
    filename.includes("/_next/") ||
    filename.includes("webpack://") ||
    filename.includes("/src/") ||
    filename.includes("\\src\\")
  );
}

function stackHasSokosumiApplicationFrame(event: Event): boolean {
  const frames = getPrimaryException(event)?.stacktrace?.frames ?? [];
  return frames.some(isSokosumiApplicationFrame);
}

function messageReferencesThirdPartyUrl(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  const urlMarkers = [
    "plausible.io",
    "linkedin.com",
    "px.ads.linkedin.com",
    "googlesyndication.com",
    "google-analytics.com",
    "googletagmanager.com",
    "doubleclick.net",
    "usercentrics.eu",
    "facebook.com",
    "connect.facebook.net",
    "hotjar.com",
    "clarity.ms",
  ];
  return urlMarkers.some((marker) => lowerMessage.includes(marker));
}

/**
 * Returns true when a browser error should not be sent to Sentry because it
 * originates from blocked or failing third-party marketing/analytics scripts.
 */
export function shouldDropThirdPartyClientError(event: Event): boolean {
  const message = getErrorMessage(event);

  const fetchHostMatch = message.match(FAILED_TO_FETCH_WITH_HOST);
  if (fetchHostMatch) {
    const host = fetchHostMatch[1].trim();
    if (isFirstPartyHost(host)) {
      return false;
    }
    if (isKnownThirdPartyHost(host)) {
      return true;
    }
    if (!stackHasSokosumiApplicationFrame(event)) {
      return true;
    }
    return false;
  }

  if (
    FAILED_TO_FETCH_DYNAMIC_IMPORT.test(message) &&
    messageReferencesThirdPartyUrl(message)
  ) {
    return true;
  }

  return false;
}
