import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Analytics hosts loaded via GTM/third-party scripts. When their beacon requests
 * fail (ad blockers, privacy extensions, offline), browsers surface unhandled
 * rejections like `TypeError: Failed to fetch (plausible.io)` — not app bugs.
 */
const THIRD_PARTY_ANALYTICS_FETCH_HOSTS = ["plausible.io"] as const;

const PLAUSIBLE_SCRIPT_FRAME = /plausible\.io|script\.file-downloads/i;

const BROWSER_EXTENSION_FRAME = /^(app:\/\/\/)?(frame_ant|injectScriptAdjust)/i;

function getErrorMessage(event: ErrorEvent, hint: EventHint): string {
  const fromException = event.exception?.values?.[0]?.value;
  if (typeof fromException === "string" && fromException.length > 0) {
    return fromException;
  }

  const original = hint.originalException;
  if (original instanceof Error && original.message) {
    return original.message;
  }

  if (typeof event.message === "string") {
    return event.message;
  }

  return "";
}

export function isThirdPartyAnalyticsFetchFailure(message: string): boolean {
  if (!message.includes("Failed to fetch")) {
    return false;
  }

  return THIRD_PARTY_ANALYTICS_FETCH_HOSTS.some((host) => {
    const escapedHost = host.replaceAll(".", "\\.");
    return new RegExp(
      `Failed to fetch\\s*\\(\\s*${escapedHost}\\s*\\)`,
      "i",
    ).test(message);
  });
}

export function isPlausibleAnalyticsStackTrace(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  if (frames.length === 0) {
    return false;
  }

  const nonSentryFrames = frames.filter(
    (frame) => frame.filename && !frame.filename.includes("@sentry"),
  );
  if (nonSentryFrames.length === 0) {
    return false;
  }

  return nonSentryFrames.every((frame) => {
    const filename = frame.filename ?? "";
    return (
      PLAUSIBLE_SCRIPT_FRAME.test(filename) ||
      BROWSER_EXTENSION_FRAME.test(filename)
    );
  });
}

/** Drop third-party analytics noise from Sentry; keep first-party fetch failures. */
export function beforeSendDropThirdPartyAnalytics(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  const message = getErrorMessage(event, hint);

  if (isThirdPartyAnalyticsFetchFailure(message)) {
    return null;
  }

  if (
    message.includes("Failed to fetch") &&
    isPlausibleAnalyticsStackTrace(event)
  ) {
    return null;
  }

  return event;
}
