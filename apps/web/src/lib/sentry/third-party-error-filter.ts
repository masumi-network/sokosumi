import type { ErrorEvent } from "@sentry/nextjs";

/** Hostnames for marketing/analytics pixels loaded via GTM or CMP (not app API). */
const THIRD_PARTY_FETCH_HOSTS = new Set([
  "plausible.io",
  "px.ads.linkedin.com",
  "pagead2.googlesyndication.com",
  "snap.licdn.com",
  "www.google-analytics.com",
  "www.googletagmanager.com",
]);

const THIRD_PARTY_STACK_FILENAME =
  /(?:plausible\.io|licdn\.com|lms-analytics|googlesyndication\.com|usercentrics\.eu|facebook\.net|doubleclick\.net)/i;

const APP_HOST = /(?:^|\.)sokosumi\.com$/i;

const FAILED_TO_FETCH_HOST = /^Failed to fetch \(([^)]+)\)$/;

const DYNAMIC_IMPORT_THIRD_PARTY =
  /Failed to fetch dynamically imported module:.*(?:usercentrics\.eu|googlesyndication|licdn\.com)/i;

/** Script origins whose client-side failures are not actionable app bugs. */
export const thirdPartyDenyUrls: Array<string | RegExp> = [
  /plausible\.io/i,
  /licdn\.com/i,
  /linkedin\.com/i,
  /lms-analytics/i,
  /googlesyndication\.com/i,
  /usercentrics\.eu/i,
  /facebook\.net/i,
  /doubleclick\.net/i,
];

function getPrimaryErrorMessage(event: ErrorEvent): string {
  const exceptionValue = event.exception?.values?.[0]?.value;
  if (typeof exceptionValue === "string" && exceptionValue.length > 0) {
    return exceptionValue;
  }
  return typeof event.message === "string" ? event.message : "";
}

function isThirdPartyFetchMessage(message: string): boolean {
  const hostMatch = message.match(FAILED_TO_FETCH_HOST);
  if (hostMatch) {
    const host = hostMatch[1];
    if (APP_HOST.test(host)) {
      return false;
    }
    return THIRD_PARTY_FETCH_HOSTS.has(host);
  }

  if (DYNAMIC_IMPORT_THIRD_PARTY.test(message)) {
    return true;
  }

  return false;
}

function stackFramesAreThirdPartyOnly(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  if (frames.length === 0) {
    return false;
  }

  const relevantFrames = frames.filter(
    (frame) => frame.in_app !== false && frame.filename,
  );
  if (relevantFrames.length === 0) {
    return false;
  }

  return relevantFrames.every(
    (frame) =>
      frame.filename !== undefined &&
      THIRD_PARTY_STACK_FILENAME.test(frame.filename),
  );
}

/**
 * Drops noisy client errors from marketing/analytics scripts (GTM, LinkedIn Insight,
 * Plausible, ads, CMP) while keeping first-party fetch failures.
 */
export function shouldDropThirdPartyClientError(event: ErrorEvent): boolean {
  const message = getPrimaryErrorMessage(event);

  if (isThirdPartyFetchMessage(message)) {
    return true;
  }

  if (
    message.includes("Failed to fetch") &&
    stackFramesAreThirdPartyOnly(event)
  ) {
    return true;
  }

  return false;
}
