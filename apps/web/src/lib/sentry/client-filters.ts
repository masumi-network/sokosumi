import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/** LinkedIn Insight Tag and other GTM marketing pixels loaded on the client. */
export const SENTRY_CLIENT_DENY_URLS: Array<string | RegExp> = [
  /li\.lms-analytics/i,
  /px\.ads\.linkedin\.com/i,
  /snap\.licdn\.com/i,
];

/**
 * Fetch failures from ad blockers / privacy tools against marketing pixels.
 * These are not actionable application defects.
 */
export const SENTRY_CLIENT_IGNORE_ERRORS: Array<string | RegExp> = [
  /^TypeError: Failed to fetch \(px\.ads\.linkedin\.com\)$/,
  /^Failed to fetch \(px\.ads\.linkedin\.com\)$/,
];

function getErrorMessage(hint: EventHint): string | undefined {
  const original = hint.originalException;
  if (original instanceof Error) {
    return original.message;
  }
  if (typeof original === "string") {
    return original;
  }
  return undefined;
}

function stackFramesReferenceLinkedInInsight(event: ErrorEvent): boolean {
  const frames =
    event.exception?.values?.flatMap(
      (value) => value.stacktrace?.frames ?? [],
    ) ?? [];

  return frames.some((frame) => {
    const filename = frame.filename ?? frame.abs_path ?? "";
    return /li\.lms-analytics|px\.ads\.linkedin\.com|snap\.licdn\.com/i.test(
      filename,
    );
  });
}

/**
 * Drops noisy third-party marketing pixel errors (e.g. LinkedIn Insight via GTM)
 * while keeping first-party fetch failures reportable.
 */
export function shouldDropClientSentryEvent(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  const message =
    event.message ??
    event.exception?.values?.[0]?.value ??
    getErrorMessage(hint);

  if (
    message &&
    SENTRY_CLIENT_IGNORE_ERRORS.some((pattern) =>
      typeof pattern === "string" ? message === pattern : pattern.test(message),
    )
  ) {
    return true;
  }

  if (stackFramesReferenceLinkedInInsight(event)) {
    const isFailedFetch =
      typeof message === "string" &&
      /failed to fetch/i.test(message) &&
      /linkedin/i.test(message);

    if (isFailedFetch) {
      return true;
    }
  }

  return false;
}

export function filterClientSentryEvent(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  return shouldDropClientSentryEvent(event, hint) ? null : event;
}
