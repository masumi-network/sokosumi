import type { ErrorEvent } from "@sentry/nextjs";

/** Hostnames for first-party API and app traffic we must keep reporting. */
const SOKOSUMI_HOST_SUFFIXES = ["sokosumi.com"] as const;

/**
 * Marketing / analytics endpoints loaded via GTM, GA, or consent tooling.
 * Failures are usually ad blockers, consent, or transient network issues.
 */
const THIRD_PARTY_ANALYTICS_HOSTS = [
  "px.ads.linkedin.com",
  "linkedin.com",
  "plausible.io",
  "pagead2.googlesyndication.com",
  "google-analytics.com",
  "region1.google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "connect.facebook.net",
  "facebook.com",
  "usercentrics.eu",
  "cmp.usercentrics.eu",
] as const;

const THIRD_PARTY_SCRIPT_FILENAME_PATTERNS = [
  /li\.lms-analytics/i,
  /plausible/i,
  /usercentrics/i,
  /googletagmanager/i,
  /googlesyndication/i,
  /frame_ant/i,
] as const;

function isSokosumiHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return SOKOSUMI_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

function isThirdPartyAnalyticsHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return THIRD_PARTY_ANALYTICS_HOSTS.some(
    (knownHost) =>
      normalized === knownHost || normalized.endsWith(`.${knownHost}`),
  );
}

function getPrimaryExceptionMessage(event: ErrorEvent): string {
  const exceptionValue = event.exception?.values?.[0]?.value;
  if (typeof exceptionValue === "string" && exceptionValue.length > 0) {
    return exceptionValue;
  }

  if (typeof event.message === "string") {
    return event.message;
  }

  return "";
}

function getStackFilenames(event: ErrorEvent): string[] {
  const frames =
    event.exception?.values?.flatMap(
      (exception) => exception.stacktrace?.frames ?? [],
    ) ?? [];

  return frames
    .map((frame) => frame.filename)
    .filter((filename): filename is string => Boolean(filename));
}

function hasThirdPartyScriptFrame(filenames: string[]): boolean {
  return filenames.some((filename) =>
    THIRD_PARTY_SCRIPT_FILENAME_PATTERNS.some((pattern) =>
      pattern.test(filename),
    ),
  );
}

function isFailedFetchToThirdPartyHost(message: string): boolean {
  const failedFetchMatch = message.match(/Failed to fetch \(([^)]+)\)/i);
  if (!failedFetchMatch) {
    return false;
  }

  const host = failedFetchMatch[1]?.trim() ?? "";
  if (!host || isSokosumiHost(host)) {
    return false;
  }

  return isThirdPartyAnalyticsHost(host);
}

function isThirdPartyDynamicImportFailure(message: string): boolean {
  if (!message.includes("Failed to fetch dynamically imported module")) {
    return false;
  }

  return (
    message.includes("usercentrics.eu") ||
    message.includes("googletagmanager.com") ||
    message.includes("google-analytics.com")
  );
}

/**
 * Returns true when a browser error is caused by third-party marketing or
 * consent scripts and should not be reported as an application defect.
 */
export function shouldDropThirdPartyNoise(event: ErrorEvent): boolean {
  const message = getPrimaryExceptionMessage(event);
  const stackFilenames = getStackFilenames(event);

  if (isFailedFetchToThirdPartyHost(message)) {
    return true;
  }

  if (isThirdPartyDynamicImportFailure(message)) {
    return true;
  }

  if (
    message.includes("Failed to fetch") &&
    hasThirdPartyScriptFrame(stackFilenames)
  ) {
    return true;
  }

  return false;
}

export function beforeSendThirdPartyNoiseFilter(
  event: ErrorEvent,
): ErrorEvent | null {
  if (shouldDropThirdPartyNoise(event)) {
    return null;
  }

  return event;
}
