import type { ErrorEvent, EventHint } from "@sentry/core";

const PLAUSIBLE_FETCH_FAILURE = /failed to fetch\s*\(\s*plausible\.io\s*\)/i;

function getExceptionMessage(event: ErrorEvent): string | undefined {
  const exception = event.exception?.values?.[0];
  return exception?.value ?? event.message;
}

function hasPlausibleScriptFrame(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  return frames.some((frame) => {
    const filename = frame.filename ?? "";
    return (
      filename.includes("plausible.io") ||
      filename.includes("script.file-downloads") ||
      filename.includes("pageview-props.tagged-events")
    );
  });
}

export function isPlausibleAnalyticsFetchFailure(event: ErrorEvent): boolean {
  const message = getExceptionMessage(event);
  if (message && PLAUSIBLE_FETCH_FAILURE.test(message)) {
    return true;
  }

  return hasPlausibleScriptFrame(event);
}

export function dropThirdPartyAnalyticsNoise(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  if (isPlausibleAnalyticsFetchFailure(event)) {
    return null;
  }

  return event;
}
