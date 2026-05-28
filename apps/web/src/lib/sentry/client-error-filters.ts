import type { ErrorEvent } from "@sentry/core";

/** Third-party analytics fetch failures are not actionable app bugs. */
const PLAUSIBLE_FETCH_FAILURE = /Failed to fetch \(plausible\.io\)/i;

export const CLIENT_IGNORE_ERRORS: Array<string | RegExp> = [
  /^TypeError: Failed to fetch \(plausible\.io\)$/,
];

/** Scripts that should not surface errors to Sentry (analytics + common extension injectors). */
export const CLIENT_DENY_URLS: Array<string | RegExp> = [
  /plausible\.io/i,
  /injectScriptAdjust\.js/i,
  /frame_ant\.js/i,
];

function getPrimaryErrorMessage(event: ErrorEvent): string {
  const exceptionMessage = event.exception?.values?.[0]?.value;
  if (typeof exceptionMessage === "string" && exceptionMessage.length > 0) {
    return exceptionMessage;
  }
  return typeof event.message === "string" ? event.message : "";
}

function getStackFrames(event: ErrorEvent) {
  return (
    event.exception?.values?.flatMap(
      (value) => value.stacktrace?.frames ?? [],
    ) ?? []
  );
}

function stackFramesOnlyFromThirdPartyAnalytics(
  frames: ReturnType<typeof getStackFrames>,
): boolean {
  if (frames.length === 0) {
    return false;
  }

  return frames.some(
    (frame) =>
      /plausible/i.test(frame.filename ?? "") ||
      /plausible\.io/i.test(frame.abs_path ?? ""),
  );
}

export function shouldDropClientSentryEvent(event: ErrorEvent): boolean {
  const frames = getStackFrames(event);
  const hasAppFrame = frames.some((frame) => frame.in_app);
  if (hasAppFrame) {
    return false;
  }

  const message = getPrimaryErrorMessage(event);
  if (PLAUSIBLE_FETCH_FAILURE.test(message)) {
    return true;
  }

  return stackFramesOnlyFromThirdPartyAnalytics(frames);
}

export function filterClientSentryEvent(event: ErrorEvent): ErrorEvent | null {
  return shouldDropClientSentryEvent(event) ? null : event;
}
