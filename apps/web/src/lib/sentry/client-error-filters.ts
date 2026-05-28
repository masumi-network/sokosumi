import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Marketing/analytics hosts loaded via GTM. When blocked (ad blockers, privacy
 * tools, extensions), their scripts reject fetch() with Chrome's
 * `Failed to fetch (hostname)` TypeError, which Sentry reports as app errors.
 */
const IGNORED_THIRD_PARTY_FETCH_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
] as const;

const THIRD_PARTY_FETCH_FAILURE_MESSAGE = /^Failed to fetch \(([^)]+)\)$/;

const THIRD_PARTY_SCRIPT_FRAME_PATTERN =
  /plausible|script\.file-downloads|googletagmanager|gtag\/|linkedin|frame_ant|injectScriptAdjust/i;

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return undefined;
}

export function getThirdPartyFetchFailureHost(
  message: string,
): string | undefined {
  const match = message.match(THIRD_PARTY_FETCH_FAILURE_MESSAGE);
  return match?.[1];
}

export function isIgnoredThirdPartyFetchFailureHost(host: string): boolean {
  return IGNORED_THIRD_PARTY_FETCH_HOSTS.some(
    (ignored) => host === ignored || host.endsWith(`.${ignored}`),
  );
}

export function isThirdPartyAnalyticsFetchFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) {
    return false;
  }

  const host = getThirdPartyFetchFailureHost(error.message);
  return host !== undefined && isIgnoredThirdPartyFetchFailureHost(host);
}

function hasThirdPartyAnalyticsStackFrame(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return frames.some((frame) =>
    THIRD_PARTY_SCRIPT_FRAME_PATTERN.test(frame.filename ?? ""),
  );
}

/**
 * Drops noisy client errors from third-party analytics/marketing scripts.
 * Does not filter first-party `Failed to fetch` (e.g. server actions).
 */
export function shouldDropClientSentryEvent(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  if (isThirdPartyAnalyticsFetchFailure(hint.originalException)) {
    return true;
  }

  const message = getErrorMessage(hint.originalException);
  if (
    message === "Failed to fetch" &&
    hasThirdPartyAnalyticsStackFrame(event)
  ) {
    return true;
  }

  return false;
}
