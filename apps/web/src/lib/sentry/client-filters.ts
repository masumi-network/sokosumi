import type { ErrorEvent } from "@sentry/nextjs";

/** Hosts for analytics/ads loaded via GTM or tags — not app failures. */
const THIRD_PARTY_FETCH_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "pagead2.googlesyndication.com",
  "region1.google-analytics.com",
  "www.google-analytics.com",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
] as const;

const THIRD_PARTY_STACK_MARKERS = [
  "plausible.io",
  "script.file-downloads",
  "googletagmanager",
  "google-analytics",
  "usercentrics.eu",
  "px.ads.linkedin",
  "googlesyndication",
] as const;

const FETCH_FAILURE_WITH_HOST = /^TypeError: Failed to fetch \(([^)]+)\)$/i;

const USERCENTRICS_DYNAMIC_IMPORT =
  /Failed to fetch dynamically imported module:.*usercentrics/i;

function getPrimaryErrorMessage(event: ErrorEvent): string {
  const fromException = event.exception?.values?.[0]?.value;
  if (fromException) {
    return fromException;
  }
  return typeof event.message === "string" ? event.message : "";
}

function getStackFrameText(event: ErrorEvent): string {
  const frames =
    event.exception?.values?.flatMap((ex) => ex.stacktrace?.frames ?? []) ?? [];
  return frames
    .map((frame) => `${frame.filename ?? ""} ${frame.abs_path ?? ""}`)
    .join(" ")
    .toLowerCase();
}

function hostMatchesThirdPartyAnalytics(host: string): boolean {
  const normalized = host.toLowerCase();
  return THIRD_PARTY_FETCH_HOSTS.some(
    (knownHost) =>
      normalized === knownHost || normalized.endsWith(`.${knownHost}`),
  );
}

function stackIndicatesThirdPartyScript(stackText: string): boolean {
  return THIRD_PARTY_STACK_MARKERS.some((marker) => stackText.includes(marker));
}

/**
 * Drops client-side noise from third-party analytics/consent scripts whose
 * network requests fail (ad blockers, extensions, offline) and surface as
 * unhandled promise rejections.
 */
export function shouldDropClientSentryEvent(event: ErrorEvent): boolean {
  const message = getPrimaryErrorMessage(event);
  if (!message) {
    return false;
  }

  if (USERCENTRICS_DYNAMIC_IMPORT.test(message)) {
    return true;
  }

  const fetchWithHost = message.match(FETCH_FAILURE_WITH_HOST);
  if (fetchWithHost && hostMatchesThirdPartyAnalytics(fetchWithHost[1])) {
    return true;
  }

  if (/failed to fetch/i.test(message)) {
    const stackText = getStackFrameText(event);
    if (stackIndicatesThirdPartyScript(stackText)) {
      return true;
    }
  }

  return false;
}
