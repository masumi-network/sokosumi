import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Marketing/analytics hosts loaded via GTM. Fetch failures here are usually
 * ad blockers or privacy extensions — not application bugs.
 */
const BLOCKED_ANALYTICS_FETCH_DOMAINS = [
  "plausible.io",
  "pagead2.googlesyndication.com",
  "region1.google-analytics.com",
  "analytics.google.com",
  "www.google-analytics.com",
  "googletagmanager.com",
] as const;

const FAILED_FETCH_DOMAIN_MESSAGE = /^Failed to fetch \(([^)]+)\)$/i;

export function getFailedFetchDomain(message: string): string | null {
  const match = message.match(FAILED_FETCH_DOMAIN_MESSAGE);
  return match?.[1] ?? null;
}

export function isBlockedThirdPartyAnalyticsFetchFailure(
  error: unknown,
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const domain = getFailedFetchDomain(error.message);
  if (!domain) {
    return false;
  }

  return BLOCKED_ANALYTICS_FETCH_DOMAINS.some(
    (blocked) => domain === blocked || domain.endsWith(`.${blocked}`),
  );
}

function eventReferencesPlausible(event: ErrorEvent): boolean {
  const exceptionValue = event.exception?.values?.[0]?.value ?? "";
  if (/plausible/i.test(exceptionValue)) {
    return true;
  }

  const frames =
    event.exception?.values?.flatMap(
      (value) => value.stacktrace?.frames ?? [],
    ) ?? [];

  return frames.some((frame) => /plausible/i.test(frame.filename ?? ""));
}

export function shouldDropClientSentryEvent(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  if (isBlockedThirdPartyAnalyticsFetchFailure(hint.originalException)) {
    return true;
  }

  const exceptionValue = event.exception?.values?.[0]?.value ?? "";
  if (
    /Failed to fetch/i.test(exceptionValue) &&
    eventReferencesPlausible(event)
  ) {
    return true;
  }

  return false;
}

export const clientSentryIgnoreErrors: Array<string | RegExp> = [
  /^TypeError: Failed to fetch \(plausible\.io\)$/i,
  /^Failed to fetch \(plausible\.io\)$/i,
  ...BLOCKED_ANALYTICS_FETCH_DOMAINS.map(
    (domain) => new RegExp(`^TypeError: Failed to fetch \\(${domain}\\)$`, "i"),
  ),
  ...BLOCKED_ANALYTICS_FETCH_DOMAINS.map(
    (domain) => new RegExp(`^Failed to fetch \\(${domain}\\)$`, "i"),
  ),
];
