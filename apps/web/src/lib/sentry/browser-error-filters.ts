import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Marketing/analytics hosts loaded via GTM. Fetch failures are expected when
 * ad blockers, privacy tools, or network policies block tracking requests.
 */
const THIRD_PARTY_FETCH_HOSTS = [
  "px.ads.linkedin.com",
  "plausible.io",
  "pagead2.googlesyndication.com",
  "www.googletagmanager.com",
  "www.google-analytics.com",
  "region1.google-analytics.com",
  "web.cmp.usercentrics.eu",
] as const;

/** Script URL patterns where errors should not be reported (Sentry denyUrls). */
export const SENTRY_DENY_URLS: Array<string | RegExp> = [
  /li\.lms-analytics/i,
  /plausible\.io/i,
  /googletagmanager\.com/i,
  /googlesyndication\.com/i,
  /usercentrics\.eu/i,
  /frame_ant/i,
  /injectScriptAdjust/i,
  /script\.file-downloads\.hash\.outbound-links/i,
];

const APP_STACK_FRAME_PATTERNS = [
  /\/_next\//i,
  /\/src\//i,
  /webpack:/i,
  /node_modules\/(?!@sentry)/,
  /sokosumi\.com/i,
] as const;

const THIRD_PARTY_STACK_FRAME_PATTERNS = [
  /lms-analytics/i,
  /plausible/i,
  /usercentrics/i,
  /googletagmanager/i,
  /googlesyndication/i,
  /frame_ant/i,
  /injectScript/i,
  /script\.file-downloads/i,
] as const;

function getErrorMessage(event: ErrorEvent, hint: EventHint): string {
  const fromHint =
    hint.originalException instanceof Error
      ? hint.originalException.message
      : typeof hint.originalException === "string"
        ? hint.originalException
        : "";
  const fromEvent = event.exception?.values?.[0]?.value ?? "";
  return fromHint || fromEvent;
}

function failedFetchHost(message: string): string | null {
  const match = message.match(/Failed to fetch \(([^)]+)\)/i);
  return match?.[1] ?? null;
}

function isKnownThirdPartyFetchHost(host: string): boolean {
  return THIRD_PARTY_FETCH_HOSTS.some(
    (known) => host === known || host.endsWith(`.${known}`),
  );
}

function hasAppStackFrame(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return frames.some((frame) =>
    APP_STACK_FRAME_PATTERNS.some((pattern) =>
      pattern.test(frame.filename ?? ""),
    ),
  );
}

function hasThirdPartyStackFrame(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return frames.some((frame) =>
    THIRD_PARTY_STACK_FRAME_PATTERNS.some((pattern) =>
      pattern.test(frame.filename ?? ""),
    ),
  );
}

export function shouldDropBrowserError(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  const message = getErrorMessage(event, hint);

  const host = failedFetchHost(message);
  if (host && isKnownThirdPartyFetchHost(host)) {
    return true;
  }

  if (
    /Failed to fetch dynamically imported module/i.test(message) &&
    /usercentrics\.eu/i.test(message)
  ) {
    return true;
  }

  if (/Failed to fetch/i.test(message) && hasThirdPartyStackFrame(event)) {
    return !hasAppStackFrame(event);
  }

  return false;
}

export function sentryBeforeSend(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  if (shouldDropBrowserError(event, hint)) {
    return null;
  }
  return event;
}
