import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const FETCH_FAILURE_WITH_HOST_PATTERN =
  /^TypeError: Failed to fetch \(([^)]+)\)$/;

const DYNAMIC_IMPORT_FAILURE_PATTERN =
  /^TypeError: Failed to fetch dynamically imported module: (https?:\/\/\S+)/;

/** Hostnames for Sokosumi APIs and the web app — never treat as third-party noise. */
const FIRST_PARTY_HOST_SUFFIXES = [".sokosumi.com", "sokosumi.com"] as const;

const FIRST_PARTY_EXACT_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isFirstPartyHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  if (FIRST_PARTY_EXACT_HOSTS.has(normalized)) {
    return true;
  }

  if (normalized.endsWith(".localhost")) {
    return true;
  }

  return FIRST_PARTY_HOST_SUFFIXES.some(
    (suffix) =>
      normalized === suffix ||
      (suffix.startsWith(".") && normalized.endsWith(suffix)),
  );
}

function getPrimaryErrorMessage(event: ErrorEvent): string | undefined {
  const value = event.exception?.values?.[0]?.value;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof event.message === "string" && event.message.length > 0) {
    return event.message;
  }

  return undefined;
}

function isThirdPartyFetchFailureMessage(message: string): boolean {
  const hostMatch = message.match(FETCH_FAILURE_WITH_HOST_PATTERN);
  if (hostMatch) {
    return !isFirstPartyHostname(hostMatch[1]);
  }

  const dynamicImportMatch = message.match(DYNAMIC_IMPORT_FAILURE_PATTERN);
  if (dynamicImportMatch) {
    try {
      const { hostname } = new URL(dynamicImportMatch[1]);
      return !isFirstPartyHostname(hostname);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Drops browser noise from marketing/analytics scripts (GTM tags, consent CMP,
 * ad blockers) that surface as unhandled `Failed to fetch` rejections.
 */
export function shouldDropBrowserEvent(
  event: ErrorEvent,
  _hint: EventHint,
): boolean {
  const message = getPrimaryErrorMessage(event);
  if (!message) {
    return false;
  }

  return isThirdPartyFetchFailureMessage(message);
}
