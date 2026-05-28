import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/** GTM-injected Plausible script fetch failures (ad blockers, privacy tools). */
const PLAUSIBLE_FETCH_ERROR_MESSAGE =
  /^TypeError: Failed to fetch \(plausible\.io\)$/i;

const PLAUSIBLE_HOST_PATTERN = /plausible\.io/i;

const PLAUSIBLE_SCRIPT_FILENAME_PATTERN =
  /script\.(file-downloads|hash|outbound-links|pageview-props|tagged-events)/i;

export const THIRD_PARTY_ANALYTICS_IGNORE_ERRORS: Array<string | RegExp> = [
  PLAUSIBLE_FETCH_ERROR_MESSAGE,
  /Failed to fetch \(plausible\.io\)/i,
];

export const THIRD_PARTY_ANALYTICS_DENY_URLS: Array<string | RegExp> = [
  PLAUSIBLE_HOST_PATTERN,
];

function getEventErrorMessage(event: ErrorEvent): string {
  const primaryException = event.exception?.values?.[0];
  return primaryException?.value ?? event.message ?? "";
}

function stackFramesOriginateFromPlausible(event: ErrorEvent): boolean {
  const frames =
    event.exception?.values?.flatMap(
      (exception) => exception.stacktrace?.frames ?? [],
    ) ?? [];

  return frames.some((frame) => {
    const locations = [frame.filename, frame.abs_path, frame.module].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

    return locations.some(
      (location) =>
        PLAUSIBLE_HOST_PATTERN.test(location) ||
        PLAUSIBLE_SCRIPT_FILENAME_PATTERN.test(location),
    );
  });
}

export function shouldDropThirdPartyAnalyticsEvent(event: ErrorEvent): boolean {
  const message = getEventErrorMessage(event);

  if (PLAUSIBLE_FETCH_ERROR_MESSAGE.test(message)) {
    return true;
  }

  if (
    /Failed to fetch/i.test(message) &&
    (PLAUSIBLE_HOST_PATTERN.test(message) ||
      stackFramesOriginateFromPlausible(event))
  ) {
    return true;
  }

  return false;
}

export function beforeSendDropThirdPartyAnalytics(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  if (shouldDropThirdPartyAnalyticsEvent(event)) {
    return null;
  }

  return event;
}
