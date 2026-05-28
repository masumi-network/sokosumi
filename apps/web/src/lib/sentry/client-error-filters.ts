import type { ErrorEvent } from "@sentry/nextjs";

/** Domains for third-party analytics loaded via GTM; fetch failures are expected noise. */
const THIRD_PARTY_ANALYTICS_HOST_PATTERN =
  /plausible\.io|google-analytics\.com|googletagmanager\.com/i;

const FAILED_TO_FETCH_PATTERN = /failed to fetch/i;

export const SENTRY_CLIENT_IGNORE_ERRORS: Array<string | RegExp> = [
  /^TypeError: Failed to fetch \(plausible\.io\)$/i,
  /Failed to fetch.*plausible\.io/i,
];

function getPrimaryExceptionMessage(event: ErrorEvent): string {
  const exception = event.exception?.values?.[0];
  if (exception?.value) {
    return exception.value;
  }
  if (exception?.type) {
    return exception.type;
  }
  return event.message ?? "";
}

function stackFramesReferenceThirdPartyAnalytics(event: ErrorEvent): boolean {
  const frames =
    event.exception?.values?.flatMap(
      (exception) => exception.stacktrace?.frames ?? [],
    ) ?? [];

  return frames.some((frame) => {
    const locations = [frame.filename, frame.abs_path, frame.module].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    return locations.some((location) =>
      THIRD_PARTY_ANALYTICS_HOST_PATTERN.test(location),
    );
  });
}

/**
 * Returns true when an unhandled rejection comes from a third-party analytics
 * script (e.g. Plausible via GTM) failing to reach its endpoint — commonly due
 * to ad blockers, privacy extensions, or consent settings.
 */
export function isThirdPartyAnalyticsFetchNoise(event: ErrorEvent): boolean {
  const message = getPrimaryExceptionMessage(event);
  const isFailedToFetch = FAILED_TO_FETCH_PATTERN.test(message);

  if (!isFailedToFetch) {
    return false;
  }

  if (THIRD_PARTY_ANALYTICS_HOST_PATTERN.test(message)) {
    return true;
  }

  return stackFramesReferenceThirdPartyAnalytics(event);
}

export function beforeSendClientError(event: ErrorEvent): ErrorEvent | null {
  if (isThirdPartyAnalyticsFetchNoise(event)) {
    return null;
  }
  return event;
}
