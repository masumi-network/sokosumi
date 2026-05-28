import type { ErrorEvent } from "@sentry/nextjs";

const PLAUSIBLE_FAILED_FETCH = /Failed to fetch \(plausible\.io\)/i;

const PLAUSIBLE_SCRIPT_URL = /plausible\.io/i;

function getPrimaryErrorMessage(event: ErrorEvent): string {
  const exceptionValue = event.exception?.values?.[0]?.value;
  if (typeof exceptionValue === "string" && exceptionValue.length > 0) {
    return exceptionValue;
  }

  if (typeof event.message === "string") {
    return event.message;
  }

  return "";
}

function stackFramesReferencePlausible(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.flatMap(
    (exception) => exception.stacktrace?.frames ?? [],
  );

  if (!frames?.length) {
    return false;
  }

  return frames.some((frame) => {
    const filename = frame.filename ?? "";
    return (
      PLAUSIBLE_SCRIPT_URL.test(filename) ||
      filename.includes("script.file-downloads.hash.outbound-links")
    );
  });
}

/**
 * Drops noisy client events from third-party analytics scripts (e.g. Plausible
 * loaded via GTM) when network requests are blocked by ad blockers or extensions.
 */
export function shouldDropThirdPartyAnalyticsClientEvent(
  event: ErrorEvent,
): boolean {
  const message = getPrimaryErrorMessage(event);
  if (PLAUSIBLE_FAILED_FETCH.test(message)) {
    return true;
  }

  return stackFramesReferencePlausible(event);
}

export function filterThirdPartyAnalyticsClientEvent(
  event: ErrorEvent,
): ErrorEvent | null {
  return shouldDropThirdPartyAnalyticsClientEvent(event) ? null : event;
}
