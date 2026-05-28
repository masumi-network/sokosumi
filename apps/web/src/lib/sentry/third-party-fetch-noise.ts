import type { ErrorEvent } from "@sentry/nextjs";

/** Hostnames for third-party scripts whose blocked fetch is not an app defect. */
const THIRD_PARTY_FETCH_NOISE_HOSTS = [
  "plausible.io",
  "pagead2.googlesyndication.com",
  "region1.google-analytics.com",
  "analytics.google.com",
  "www.google.com",
  "www.googletagmanager.com",
] as const;

const FAILED_TO_FETCH_WITH_HOST = /^TypeError: Failed to fetch \(([^)]+)\)$/;

const USERCENTRICS_DYNAMIC_IMPORT =
  /^TypeError: Failed to fetch dynamically imported module: https:\/\/web\.cmp\.usercentrics\.eu\//;

const PLAUSIBLE_SCRIPT_FRAME = /plausible\.io|script\.file-downloads/;

export function isThirdPartyFetchNoiseMessage(message: string): boolean {
  if (USERCENTRICS_DYNAMIC_IMPORT.test(message)) {
    return true;
  }

  const hostMatch = message.match(FAILED_TO_FETCH_WITH_HOST);
  if (!hostMatch) {
    return false;
  }

  const host = hostMatch[1];
  return THIRD_PARTY_FETCH_NOISE_HOSTS.some(
    (noiseHost) => host === noiseHost || host.endsWith(`.${noiseHost}`),
  );
}

function hasPlausibleStackFrame(event: ErrorEvent): boolean {
  const frames =
    event.exception?.values?.flatMap(
      (exception) => exception.stacktrace?.frames ?? [],
    ) ?? [];

  return frames.some((frame) =>
    PLAUSIBLE_SCRIPT_FRAME.test(frame.filename ?? ""),
  );
}

/** Drop client-side noise from analytics/CMP scripts blocked by the browser or extensions. */
export function shouldDropThirdPartyFetchNoiseEvent(
  event: ErrorEvent,
): boolean {
  const rawMessage = event.exception?.values?.[0]?.value ?? event.message;
  const message = typeof rawMessage === "string" ? rawMessage : "";

  if (typeof message !== "string" || message.length === 0) {
    return hasPlausibleStackFrame(event);
  }

  if (isThirdPartyFetchNoiseMessage(message)) {
    return true;
  }

  return hasPlausibleStackFrame(event);
}
