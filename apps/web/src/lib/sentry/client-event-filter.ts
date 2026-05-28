import type { ErrorEvent } from "@sentry/nextjs";

/** Third-party hosts whose fetch failures are not actionable app bugs. */
const THIRD_PARTY_FETCH_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "pagead2.googlesyndication.com",
] as const;

const BROWSER_EXTENSION_FRAME_PATTERNS = [
  /injectScriptAdjust\.js/i,
  /frame_ant\//i,
] as const;

const PLAUSIBLE_SCRIPT_FRAME_PATTERN =
  /script\.file-downloads\.hash\.outbound-links/i;

const FAILED_TO_FETCH_WITH_HOST = /^TypeError: Failed to fetch \(([^)]+)\)$/;

function getPrimaryExceptionValue(event: ErrorEvent): string | undefined {
  return event.exception?.values?.[0]?.value;
}

function getStackFrames(event: ErrorEvent) {
  return event.exception?.values?.[0]?.stacktrace?.frames ?? [];
}

function isThirdPartyFetchFailure(message: string): boolean {
  const match = FAILED_TO_FETCH_WITH_HOST.exec(message);
  if (!match) {
    return false;
  }

  const host = match[1].toLowerCase();
  return THIRD_PARTY_FETCH_HOSTS.some((thirdPartyHost) =>
    host.includes(thirdPartyHost),
  );
}

function frameLooksLikeBrowserExtensionOrInjectedAnalytics(
  filename: string,
): boolean {
  return (
    BROWSER_EXTENSION_FRAME_PATTERNS.some((pattern) =>
      pattern.test(filename),
    ) || PLAUSIBLE_SCRIPT_FRAME_PATTERN.test(filename)
  );
}

function stacktraceIsExtensionOrInjectedAnalyticsOnly(
  event: ErrorEvent,
): boolean {
  const frames = getStackFrames(event).filter(
    (frame) => !frame.filename?.includes("@sentry"),
  );

  if (frames.length === 0) {
    return false;
  }

  return frames.every((frame) =>
    frameLooksLikeBrowserExtensionOrInjectedAnalytics(frame.filename ?? ""),
  );
}

/**
 * Drops client-side Sentry noise from browser extensions and third-party
 * analytics scripts that are not part of the Sokosumi application bundle.
 */
export function shouldDropBrowserNoiseEvent(event: ErrorEvent): boolean {
  const message = getPrimaryExceptionValue(event);
  if (message && isThirdPartyFetchFailure(message)) {
    return true;
  }

  return stacktraceIsExtensionOrInjectedAnalyticsOnly(event);
}

export const browserNoiseSentryClientOptions = {
  denyUrls: [/injectScriptAdjust\.js/i, /frame_ant\//i, /plausible\.io/i],
  ignoreErrors: [
    /^TypeError: Failed to fetch \(plausible\.io\)$/i,
    /^TypeError: Failed to fetch \(px\.ads\.linkedin\.com\)$/i,
    /^TypeError: Failed to fetch \(pagead2\.googlesyndication\.com\)$/i,
  ],
  beforeSend(event: ErrorEvent) {
    if (shouldDropBrowserNoiseEvent(event)) {
      return null;
    }

    return event;
  },
} as const;
