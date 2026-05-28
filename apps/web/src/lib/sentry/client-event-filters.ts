import type { ErrorEvent } from "@sentry/nextjs";

/** Analytics hosts loaded via GTM; fetch failures are expected when blocked. */
const IGNORABLE_ANALYTICS_HOSTS = ["plausible.io"] as const;

const FAILED_FETCH_MESSAGE = /^TypeError: Failed to fetch \(([^)]+)\)$/;

const PLAUSIBLE_SCRIPT_FRAME_PATTERN = /plausible/i;

function getPrimaryExceptionValue(event: ErrorEvent): string | undefined {
  const value = event.exception?.values?.[0]?.value;
  return typeof value === "string" ? value : undefined;
}

function getStackFilenames(event: ErrorEvent): string[] {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return frames
    .map((frame) => frame.filename)
    .filter((filename): filename is string => typeof filename === "string");
}

function isIgnorableAnalyticsFetchFailure(message: string): boolean {
  const match = FAILED_FETCH_MESSAGE.exec(message);
  if (!match) {
    return false;
  }

  const host = match[1]?.toLowerCase() ?? "";
  return IGNORABLE_ANALYTICS_HOSTS.some((analyticsHost) =>
    host.includes(analyticsHost),
  );
}

function stackIndicatesPlausibleScript(filenames: string[]): boolean {
  return filenames.some((filename) =>
    PLAUSIBLE_SCRIPT_FRAME_PATTERN.test(filename),
  );
}

/**
 * Drops client-side noise from third-party analytics (e.g. Plausible via GTM)
 * when network requests fail due to ad blockers, privacy tools, or extensions.
 */
export function shouldDropThirdPartyAnalyticsNoise(event: ErrorEvent): boolean {
  const message = getPrimaryExceptionValue(event);
  const filenames = getStackFilenames(event);

  if (message && isIgnorableAnalyticsFetchFailure(message)) {
    return true;
  }

  return (
    typeof message === "string" &&
    message.includes("Failed to fetch") &&
    stackIndicatesPlausibleScript(filenames)
  );
}
