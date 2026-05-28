import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const THIRD_PARTY_FETCH_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "pagead2.googlesyndication.com",
  "www.google-analytics.com",
  "region1.google-analytics.com",
  "google-analytics.com",
  "www.googletagmanager.com",
  "stats.g.doubleclick.net",
] as const;

const USERCENTRICS_DYNAMIC_IMPORT_FAILURE =
  /^Failed to fetch dynamically imported module: https:\/\/web\.cmp\.usercentrics\.eu\//;

export const SENTRY_IGNORED_THIRD_PARTY_ERRORS: Array<string | RegExp> = [
  ...THIRD_PARTY_FETCH_HOSTS.map(
    (host) =>
      new RegExp(`^Failed to fetch \\(${host.replaceAll(".", "\\.")}\\)$`),
  ),
  USERCENTRICS_DYNAMIC_IMPORT_FAILURE,
];

export const SENTRY_DENIED_THIRD_PARTY_SCRIPT_URLS: RegExp[] = [
  /plausible\.io/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /googlesyndication\.com/i,
  /px\.ads\.linkedin\.com/i,
  /usercentrics\.eu/i,
  /doubleclick\.net/i,
];

function isKnownThirdPartyFetchHost(host: string): boolean {
  return THIRD_PARTY_FETCH_HOSTS.some(
    (knownHost) => host === knownHost || host.endsWith(`.${knownHost}`),
  );
}

export function shouldIgnoreThirdPartyClientError(message: string): boolean {
  if (USERCENTRICS_DYNAMIC_IMPORT_FAILURE.test(message)) {
    return true;
  }

  const fetchFailureMatch = /^Failed to fetch \(([^)]+)\)$/.exec(message);
  if (!fetchFailureMatch) {
    return false;
  }

  return isKnownThirdPartyFetchHost(fetchFailureMatch[1]);
}

export function beforeSendThirdPartyClientErrorFilter(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  const originalException = hint.originalException;

  if (originalException instanceof Error) {
    if (shouldIgnoreThirdPartyClientError(originalException.message)) {
      return null;
    }
  }

  const eventMessage = event.message ?? event.exception?.values?.[0]?.value;
  if (
    typeof eventMessage === "string" &&
    shouldIgnoreThirdPartyClientError(eventMessage)
  ) {
    return null;
  }

  return event;
}
