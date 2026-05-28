import type { ErrorEvent } from "@sentry/nextjs";

/** Chrome reports blocked third-party analytics fetches with the host in parentheses. */
const PLAUSIBLE_FETCH_ERROR = /Failed to fetch.*plausible\.io/i;

/** Plausible hosted script filename fragment seen in production events. */
const PLAUSIBLE_SCRIPT_FRAME =
  /plausible|script\.file-downloads\.hash\.outbound-links/i;

export const CLIENT_IGNORE_ERRORS: Array<string | RegExp> = [
  PLAUSIBLE_FETCH_ERROR,
];

function getEventMessage(event: ErrorEvent): string {
  const primaryException = event.exception?.values?.[0];
  return primaryException?.value ?? event.message ?? "";
}

function hasPlausibleStackFrame(event: ErrorEvent): boolean {
  const frames =
    event.exception?.values?.flatMap(
      (value) => value.stacktrace?.frames ?? [],
    ) ?? [];

  return frames.some((frame) => {
    const location = `${frame.filename ?? ""}${frame.abs_path ?? ""}`;
    return PLAUSIBLE_SCRIPT_FRAME.test(location);
  });
}

/**
 * Drops client errors from browser extensions injecting Plausible analytics.
 * Sokosumi does not load Plausible; these are unhandled fetch rejections only.
 */
export function shouldDropClientSentryEvent(event: ErrorEvent): boolean {
  const message = getEventMessage(event);

  if (PLAUSIBLE_FETCH_ERROR.test(message)) {
    return true;
  }

  return hasPlausibleStackFrame(event) && /failed to fetch/i.test(message);
}

export function filterClientSentryEvent(event: ErrorEvent): ErrorEvent | null {
  return shouldDropClientSentryEvent(event) ? null : event;
}
