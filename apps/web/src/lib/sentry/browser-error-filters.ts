import type { ErrorEvent } from "@sentry/core";

/**
 * Third-party marketing/analytics hosts whose blocked fetch failures are expected
 * (ad blockers, privacy extensions, network filters) and are not Sokosumi bugs.
 *
 * Keep `app.sokosumi.com` and `api.sokosumi.com` out of this list so real API
 * outages continue to surface in Sentry.
 */
export const SENTRY_IGNORED_THIRD_PARTY_FETCH_HOSTS = [
  "px.ads.linkedin.com",
  "plausible.io",
  "pagead2.googlesyndication.com",
] as const;

const SOKOSUMI_FETCH_HOSTS = ["app.sokosumi.com", "api.sokosumi.com"] as const;

/** Stack frame script URLs for third-party tags loaded via GTM / consent tooling. */
export const SENTRY_DENIED_THIRD_PARTY_SCRIPT_URL_PATTERNS = [
  /px\.ads\.linkedin\.com/i,
  /li\.lms-analytics/i,
  /plausible\.io/i,
  /googlesyndication\.com/i,
  /usercentrics\.eu/i,
] as const;

const THIRD_PARTY_FETCH_FAILURE = /^TypeError: Failed to fetch \(([^)]+)\)$/;

const THIRD_PARTY_DYNAMIC_IMPORT_FAILURE =
  /^TypeError: Failed to fetch dynamically imported module:.*usercentrics/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildIgnoredThirdPartyFetchErrorPatterns(): RegExp[] {
  const hostPatterns = SENTRY_IGNORED_THIRD_PARTY_FETCH_HOSTS.map(
    (host) =>
      new RegExp(`^TypeError: Failed to fetch \\(${escapeRegExp(host)}\\)$`),
  );

  return [...hostPatterns, THIRD_PARTY_DYNAMIC_IMPORT_FAILURE];
}

function isSokosumiFetchHost(host: string): boolean {
  return SOKOSUMI_FETCH_HOSTS.some(
    (sokosumiHost) =>
      host === sokosumiHost || host.endsWith(`.${sokosumiHost}`),
  );
}

export function isIgnoredThirdPartyFetchFailure(message: string): boolean {
  const match = THIRD_PARTY_FETCH_FAILURE.exec(message);
  if (!match) {
    return false;
  }

  const host = match[1];
  if (isSokosumiFetchHost(host)) {
    return false;
  }

  return SENTRY_IGNORED_THIRD_PARTY_FETCH_HOSTS.some(
    (ignoredHost) => host === ignoredHost || host.endsWith(`.${ignoredHost}`),
  );
}

export function isIgnoredThirdPartyDynamicImportFailure(
  message: string,
): boolean {
  return THIRD_PARTY_DYNAMIC_IMPORT_FAILURE.test(message);
}

export function shouldDropThirdPartyBrowserError(event: ErrorEvent): boolean {
  const exceptions = event.exception?.values ?? [];

  for (const exception of exceptions) {
    const message = exception.value;
    if (!message) {
      continue;
    }

    if (
      isIgnoredThirdPartyFetchFailure(message) ||
      isIgnoredThirdPartyDynamicImportFailure(message)
    ) {
      return true;
    }
  }

  return false;
}

export function beforeSendBrowserEvent(event: ErrorEvent): ErrorEvent | null {
  if (shouldDropThirdPartyBrowserError(event)) {
    return null;
  }

  return event;
}
