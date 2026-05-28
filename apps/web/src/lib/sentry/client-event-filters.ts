import type { ErrorEvent } from "@sentry/nextjs";

/** Marketing / analytics hosts loaded via GTM or CMP — not app-owned APIs. */
const THIRD_PARTY_FETCH_FAILURE_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "pagead2.googlesyndication.com",
  "www.google-analytics.com",
  "region1.google-analytics.com",
  "analytics.google.com",
  "googleads.g.doubleclick.net",
  "connect.facebook.net",
  "snap.licdn.com",
] as const;

const BROWSER_EXTENSION_FILENAME_PATTERN =
  /^(chrome-extension|moz-extension|safari-extension):|frame_ant/i;

const THIRD_PARTY_SCRIPT_FRAME_PATTERN =
  /plausible|li\.lms-analytics|linkedin|licdn\.com|googlesyndication|google-analytics/i;

/** Matches "Failed to fetch (host)" with or without a leading exception type. */
const FAILED_TO_FETCH_WITH_HOST = /Failed to fetch \(([^)]+)\)/;

function getPrimaryExceptionMessage(event: ErrorEvent): string {
  const value = event.exception?.values?.[0]?.value;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return typeof event.message === "string" ? event.message : "";
}

function getStackFilenames(event: ErrorEvent): string[] {
  const frames =
    event.exception?.values?.flatMap(
      (exception) => exception.stacktrace?.frames ?? [],
    ) ?? [];

  return frames
    .map((frame) => frame.filename)
    .filter((filename): filename is string => typeof filename === "string");
}

function isKnownThirdPartyFetchHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return THIRD_PARTY_FETCH_FAILURE_HOSTS.some(
    (knownHost) =>
      normalized === knownHost || normalized.endsWith(`.${knownHost}`),
  );
}

export function isThirdPartyFetchFailureMessage(message: string): boolean {
  const match = message.match(FAILED_TO_FETCH_WITH_HOST);
  if (!match) {
    return false;
  }
  return isKnownThirdPartyFetchHost(match[1]);
}

export function eventHasBrowserExtensionFrame(event: ErrorEvent): boolean {
  return getStackFilenames(event).some((filename) =>
    BROWSER_EXTENSION_FILENAME_PATTERN.test(filename),
  );
}

function stackIndicatesThirdPartyMarketingScript(filenames: string[]): boolean {
  return filenames.some((filename) =>
    THIRD_PARTY_SCRIPT_FRAME_PATTERN.test(filename),
  );
}

/**
 * Drops client-side noise from blocked marketing pixels and extension-injected
 * scripts. Does not filter first-party API failures (e.g. api.sokosumi.com).
 */
export function shouldDropThirdPartyAnalyticsNoise(event: ErrorEvent): boolean {
  const message = getPrimaryExceptionMessage(event);
  const filenames = getStackFilenames(event);

  if (isThirdPartyFetchFailureMessage(message)) {
    return true;
  }

  if (
    message.includes("Failed to fetch") &&
    (eventHasBrowserExtensionFrame(event) ||
      stackIndicatesThirdPartyMarketingScript(filenames))
  ) {
    return true;
  }

  return false;
}
