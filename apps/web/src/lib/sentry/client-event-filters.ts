import type { ErrorEvent } from "@sentry/nextjs";

/** Marketing / analytics hosts loaded via GTM or CMP — not app-owned APIs. */
const THIRD_PARTY_FETCH_FAILURE_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "pagead2.googlesyndication.com",
  "www.google-analytics.com",
  "googleads.g.doubleclick.net",
  "connect.facebook.net",
  "snap.licdn.com",
] as const;

const BROWSER_EXTENSION_FILENAME_PATTERN =
  /^(chrome-extension|moz-extension|safari-extension):|frame_ant/i;

const FAILED_TO_FETCH_WITH_HOST = /^Failed to fetch \(([^)]+)\)$/;

function getPrimaryExceptionMessage(event: ErrorEvent): string {
  const value = event.exception?.values?.[0]?.value;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return typeof event.message === "string" ? event.message : "";
}

function isKnownThirdPartyFetchHost(host: string): boolean {
  return THIRD_PARTY_FETCH_FAILURE_HOSTS.some(
    (knownHost) => host === knownHost || host.endsWith(`.${knownHost}`),
  );
}

export function isThirdPartyFetchFailureMessage(message: string): boolean {
  const match = message.match(FAILED_TO_FETCH_WITH_HOST);
  if (!match) {
    return false;
  }
  return isKnownThirdPartyFetchHost(match[1]);
}

export function eventHasBrowserExtensionFrame(event: ErrorEvent): boolean {
  const frames =
    event.exception?.values?.flatMap(
      (exception) => exception.stacktrace?.frames ?? [],
    ) ?? [];

  return frames.some((frame) =>
    BROWSER_EXTENSION_FILENAME_PATTERN.test(frame.filename ?? ""),
  );
}

/** Drop client noise from blocked marketing pixels and extension-injected scripts. */
export function shouldDropClientSentryEvent(event: ErrorEvent): boolean {
  const message = getPrimaryExceptionMessage(event);

  if (isThirdPartyFetchFailureMessage(message)) {
    return true;
  }

  if (
    message.includes("Failed to fetch") &&
    eventHasBrowserExtensionFrame(event)
  ) {
    return true;
  }

  return false;
}
