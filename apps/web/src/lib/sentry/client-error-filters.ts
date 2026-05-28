import type { ErrorEvent, Event } from "@sentry/nextjs";

/**
 * Marketing/analytics hosts loaded via GTM that commonly fail when blocked by
 * ad blockers or privacy extensions. These are not actionable app errors.
 */
export const THIRD_PARTY_ANALYTICS_FETCH_HOSTS = [
  "px.ads.linkedin.com",
  "plausible.io",
] as const;

const failedFetchHostPattern = new RegExp(
  `^TypeError: Failed to fetch \\(${THIRD_PARTY_ANALYTICS_FETCH_HOSTS.map(
    (host) => host.replaceAll(".", "\\."),
  ).join("|")}\\)$`,
);

export const THIRD_PARTY_ANALYTICS_IGNORE_ERRORS: Array<string | RegExp> = [
  failedFetchHostPattern,
];

export const THIRD_PARTY_ANALYTICS_DENY_URLS: Array<string | RegExp> = [
  /linkedin\.com/i,
  /li\.lms-analytics/i,
  /plausible\.io/i,
];

function getEventMessages(event: Event): string[] {
  const messages: string[] = [];

  if (typeof event.message === "string") {
    messages.push(event.message);
  }

  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === "string") {
      messages.push(exception.value);
    }
    if (
      typeof exception.type === "string" &&
      typeof exception.value === "string"
    ) {
      messages.push(`${exception.type}: ${exception.value}`);
    }
  }

  return messages;
}

function matchesBlockedAnalyticsFetch(message: string): boolean {
  const hostMatch = /Failed to fetch \(([^)]+)\)/.exec(message);
  if (!hostMatch) {
    return false;
  }

  return THIRD_PARTY_ANALYTICS_FETCH_HOSTS.includes(
    hostMatch[1] as (typeof THIRD_PARTY_ANALYTICS_FETCH_HOSTS)[number],
  );
}

function hasOnlyThirdPartyAnalyticsFrames(event: ErrorEvent): boolean {
  const frames =
    event.exception?.values?.flatMap(
      (exception) => exception.stacktrace?.frames ?? [],
    ) ?? [];

  if (frames.length === 0) {
    return false;
  }

  const relevantFrames = frames.filter(
    (frame) => frame.in_app !== false && frame.filename,
  );

  if (relevantFrames.length === 0) {
    return false;
  }

  return relevantFrames.every((frame) =>
    THIRD_PARTY_ANALYTICS_DENY_URLS.some((pattern) =>
      pattern instanceof RegExp
        ? pattern.test(frame.filename ?? "")
        : (frame.filename ?? "").includes(pattern),
    ),
  );
}

export function shouldDropThirdPartyAnalyticsError(event: ErrorEvent): boolean {
  if (
    getEventMessages(event).some(
      (message) =>
        matchesBlockedAnalyticsFetch(message) ||
        failedFetchHostPattern.test(message),
    )
  ) {
    return true;
  }

  return hasOnlyThirdPartyAnalyticsFrames(event);
}
