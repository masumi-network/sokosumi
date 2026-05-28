import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Hostnames for marketing/analytics scripts loaded via GTM or similar.
 * When their network calls fail (ad blockers, consent, offline), browsers surface
 * unhandled `TypeError: Failed to fetch (<host>)` rejections that are not app bugs.
 */
const THIRD_PARTY_ANALYTICS_FETCH_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "snap.licdn.com",
  "linkedin.com",
] as const;

const THIRD_PARTY_SCRIPT_URL_PATTERNS: RegExp[] = [
  /plausible\.io/i,
  /linkedin\.com/i,
  /licdn\.com/i,
  /lms-analytics/i,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const thirdPartyAnalyticsIgnoreErrors: RegExp[] =
  THIRD_PARTY_ANALYTICS_FETCH_HOSTS.map(
    (host) => new RegExp(`Failed to fetch \\(${escapeRegExp(host)}\\)`, "i"),
  );

export const thirdPartyAnalyticsDenyUrls: RegExp[] = [
  ...THIRD_PARTY_SCRIPT_URL_PATTERNS,
];

function getErrorMessage(event: ErrorEvent): string {
  const exceptionValue = event.exception?.values?.[0]?.value;
  if (typeof exceptionValue === "string" && exceptionValue.length > 0) {
    return exceptionValue;
  }

  if (typeof event.message === "string") {
    return event.message;
  }

  return "";
}

function messageNamesThirdPartyAnalyticsHost(message: string): boolean {
  if (!message.includes("Failed to fetch")) {
    return false;
  }

  return THIRD_PARTY_ANALYTICS_FETCH_HOSTS.some((host) =>
    message.includes(host),
  );
}

function stackFramesAreOnlyThirdPartyAnalytics(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  const scriptFrames = frames.filter((frame) => {
    const filename = frame.filename;
    return (
      typeof filename === "string" &&
      filename.length > 0 &&
      !filename.includes("@sentry") &&
      !filename.includes("node_modules/.pnpm/next@")
    );
  });

  if (scriptFrames.length === 0) {
    return false;
  }

  return scriptFrames.every((frame) =>
    THIRD_PARTY_SCRIPT_URL_PATTERNS.some((pattern) =>
      pattern.test(frame.filename ?? ""),
    ),
  );
}

export function isThirdPartyAnalyticsFetchNoise(event: ErrorEvent): boolean {
  const message = getErrorMessage(event);
  if (messageNamesThirdPartyAnalyticsHost(message)) {
    return true;
  }

  return stackFramesAreOnlyThirdPartyAnalytics(event);
}

export function thirdPartyAnalyticsBeforeSend(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  if (isThirdPartyAnalyticsFetchNoise(event)) {
    return null;
  }

  return event;
}
