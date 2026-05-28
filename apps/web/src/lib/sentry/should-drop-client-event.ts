import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/** Hostnames in Chrome's `Failed to fetch (<host>)` message from blocked marketing pixels. */
const BLOCKED_MARKETING_FETCH_HOST_PATTERNS = [
  /px\.ads\.linkedin\.com/i,
  /plausible\.io/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /doubleclick\.net/i,
  /facebook\.com/i,
  /connect\.facebook\.net/i,
];

const THIRD_PARTY_SCRIPT_FILENAME_PATTERNS = [
  /lms-analytics/i,
  /insight\.old\.min\.js/i,
  /plausible/i,
  /googletagmanager/i,
  /google-analytics/i,
  /gtag\/js/i,
  /doubleclick/i,
  /facebook\.net/i,
  /frame_ant/i,
  /injectScriptAdjust/i,
];

function getPrimaryExceptionValue(event: ErrorEvent): string {
  const value = event.exception?.values?.[0]?.value;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return typeof event.message === "string" ? event.message : "";
}

function getStackFrames(event: ErrorEvent) {
  return (
    event.exception?.values?.flatMap(
      (entry) => entry.stacktrace?.frames ?? [],
    ) ?? []
  );
}

function isBlockedMarketingFetchMessage(message: string): boolean {
  const match = message.match(/^Failed to fetch \(([^)]+)\)$/i);
  if (!match) {
    return false;
  }
  const host = match[1];
  return BLOCKED_MARKETING_FETCH_HOST_PATTERNS.some((pattern) =>
    pattern.test(host),
  );
}

function isThirdPartyScriptFilename(filename: string | undefined): boolean {
  if (!filename) {
    return false;
  }
  return THIRD_PARTY_SCRIPT_FILENAME_PATTERNS.some((pattern) =>
    pattern.test(filename),
  );
}

function hasApplicationStackFrame(event: ErrorEvent): boolean {
  return getStackFrames(event).some((frame) => frame.in_app === true);
}

function isServerActionFetchFailure(event: ErrorEvent): boolean {
  return getStackFrames(event).some((frame) =>
    /server-action-reducer/i.test(frame.filename ?? ""),
  );
}

/**
 * Drops client-side noise from marketing/analytics scripts (GTM, LinkedIn Insight
 * Tag, Plausible, etc.) when ad blockers or privacy tools block their network calls.
 */
export function shouldDropClientSentryEvent(
  event: ErrorEvent,
  _hint?: EventHint,
): boolean {
  if (isServerActionFetchFailure(event)) {
    return false;
  }

  const message = getPrimaryExceptionValue(event);
  if (isBlockedMarketingFetchMessage(message)) {
    return true;
  }

  const frames = getStackFrames(event);
  if (frames.length === 0) {
    return false;
  }

  if (hasApplicationStackFrame(event)) {
    return false;
  }

  const hasThirdPartyScriptFrame = frames.some((frame) =>
    isThirdPartyScriptFilename(frame.filename),
  );
  if (hasThirdPartyScriptFrame && /failed to fetch/i.test(message)) {
    return true;
  }

  return false;
}
