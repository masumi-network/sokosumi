import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/** Hostnames for marketing/analytics pixels loaded via GTM — not app API calls. */
const THIRD_PARTY_AD_PIXEL_HOSTS = [
  "px.ads.linkedin.com",
  "www.facebook.com",
  "connect.facebook.net",
  "www.google-analytics.com",
  "analytics.google.com",
  "stats.g.doubleclick.net",
] as const;

/**
 * URL substrings for injected scripts (browser extensions, GTM wrappers) that
 * should not create Sentry issues for the Sokosumi app.
 */
const EXTERNAL_SCRIPT_URL_MARKERS = [
  "frame_ant",
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "safari-web-extension://",
] as const;

/** Chrome reports blocked third-party fetches as `Failed to fetch (hostname)`. */
const THIRD_PARTY_FETCH_FAILURE = /^Failed to fetch \([^)]+\)$/i;

export const sentryClientIgnoreErrors: Array<string | RegExp> = [
  ...THIRD_PARTY_AD_PIXEL_HOSTS.map(
    (host) => new RegExp(`^Failed to fetch \\(${escapeRegExp(host)}\\)$`, "i"),
  ),
];

export const sentryClientDenyUrls: Array<string | RegExp> = [
  ...EXTERNAL_SCRIPT_URL_MARKERS.map(
    (marker) => new RegExp(escapeRegExp(marker)),
  ),
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPrimaryExceptionMessage(event: ErrorEvent): string {
  const value = event.exception?.values?.[0]?.value;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof event.message === "string") {
    return event.message;
  }
  return "";
}

function getStackFrameFilenames(event: ErrorEvent): string[] {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return frames
    .map((frame) => frame.filename)
    .filter((filename): filename is string => typeof filename === "string");
}

function isExternalScriptFrame(filename: string): boolean {
  if (filename.startsWith("app:///")) {
    return EXTERNAL_SCRIPT_URL_MARKERS.some((marker) =>
      filename.includes(marker),
    );
  }
  return EXTERNAL_SCRIPT_URL_MARKERS.some((marker) =>
    filename.includes(marker),
  );
}

function isThirdPartyAdPixelFetchFailure(message: string): boolean {
  const match = message.match(THIRD_PARTY_FETCH_FAILURE);
  if (!match) {
    return false;
  }
  const hostMatch = message.match(/\(([^)]+)\)/);
  const host = hostMatch?.[1]?.toLowerCase() ?? "";
  return THIRD_PARTY_AD_PIXEL_HOSTS.some(
    (knownHost) => host === knownHost || host.endsWith(`.${knownHost}`),
  );
}

export function shouldDropSentryClientNoise(event: ErrorEvent): boolean {
  const message = getPrimaryExceptionMessage(event);
  if (message && isThirdPartyAdPixelFetchFailure(message)) {
    return true;
  }

  const filenames = getStackFrameFilenames(event);
  if (
    filenames.length > 0 &&
    filenames.every((filename) => isExternalScriptFrame(filename))
  ) {
    return true;
  }

  return false;
}

export function sentryClientBeforeSend(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  if (shouldDropSentryClientNoise(event)) {
    return null;
  }
  return event;
}
