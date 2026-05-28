import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/** Domains loaded via GTM / marketing tags that commonly fail under ad blockers. */
const THIRD_PARTY_ANALYTICS_HOSTS = [
  "px.ads.linkedin.com",
  "plausible.io",
  "www.google-analytics.com",
  "www.googletagmanager.com",
  "connect.facebook.net",
  "snap.licdn.com",
] as const;

const FAILED_TO_FETCH_WITH_HOST =
  /^(?:TypeError: )?Failed to fetch \(([^)]+)\)$/;

const BROWSER_EXTENSION_FRAME_PATTERN =
  /(?:^chrome-extension:\/\/|\/extensions\/|frame_ant)/i;

function getExceptionMessage(
  event: ErrorEvent,
  hint: EventHint,
): string | undefined {
  const fromHint = hint.originalException;
  if (fromHint instanceof Error && fromHint.message) {
    return fromHint.message;
  }

  const value = event.exception?.values?.[0]?.value;
  return typeof value === "string" ? value : undefined;
}

function isThirdPartyAnalyticsFetchFailure(message: string): boolean {
  const match = message.match(FAILED_TO_FETCH_WITH_HOST);
  if (!match) {
    return false;
  }

  const host = match[1].toLowerCase();
  return THIRD_PARTY_ANALYTICS_HOSTS.some(
    (knownHost) => host === knownHost || host.endsWith(`.${knownHost}`),
  );
}

function stackFramesOnlyFromBrowserExtensions(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  if (frames.length === 0) {
    return false;
  }

  return frames.every((frame) => {
    if (frame.in_app) {
      return false;
    }

    const filename = frame.filename ?? frame.abs_path ?? "";
    return (
      BROWSER_EXTENSION_FRAME_PATTERN.test(filename) ||
      filename.startsWith("app:///")
    );
  });
}

/**
 * Drops client-side noise from blocked third-party pixels and browser extensions.
 * Real application fetch failures keep in-app stack frames and are reported.
 */
export function shouldDropClientErrorEvent(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  const message = getExceptionMessage(event, hint);
  if (!message) {
    return false;
  }

  if (isThirdPartyAnalyticsFetchFailure(message)) {
    return true;
  }

  if (message === "Failed to fetch" || message.startsWith("Failed to fetch ")) {
    if (stackFramesOnlyFromBrowserExtensions(event)) {
      return true;
    }
  }

  return false;
}

export function beforeSendClientError(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  return shouldDropClientErrorEvent(event, hint) ? null : event;
}

/** Sentry `ignoreErrors` patterns for third-party fetch rejections. */
export const sentryClientIgnoreErrors: Array<string | RegExp> = [
  /^(?:TypeError: )?Failed to fetch \(px\.ads\.linkedin\.com\)$/,
  /^(?:TypeError: )?Failed to fetch \(plausible\.io\)$/,
];
