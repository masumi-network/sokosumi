import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const THIRD_PARTY_FETCH_FAILURE_DOMAINS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "pagead2.googlesyndication.com",
  "www.google.com",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const thirdPartyFetchFailureIgnoreErrors: RegExp[] =
  THIRD_PARTY_FETCH_FAILURE_DOMAINS.map(
    (domain) =>
      new RegExp(`^Failed to fetch \\(${escapeRegExp(domain)}\\)$`, "i"),
  );

export const thirdPartyScriptDenyUrls: RegExp[] = [
  /plausible\.io/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /googlesyndication\.com/i,
  /doubleclick\.net/i,
  /px\.ads\.linkedin\.com/i,
  /web\.cmp\.usercentrics\.eu/i,
];

const thirdPartyDynamicImportFailure =
  /^Failed to fetch dynamically imported module: https:\/\/web\.cmp\.usercentrics\.eu\//i;

const plausibleScriptFramePattern =
  /plausible|script\.file-downloads\.hash\.outbound-links/i;

function getErrorMessage(event: ErrorEvent, hint: EventHint): string {
  const exceptionValue = event.exception?.values?.[0]?.value;
  if (typeof exceptionValue === "string" && exceptionValue.length > 0) {
    return exceptionValue;
  }

  const originalException = hint.originalException;
  if (originalException instanceof Error) {
    return originalException.message;
  }

  if (typeof originalException === "string") {
    return originalException;
  }

  return "";
}

function hasPlausibleScriptFrame(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  return frames.some((frame) =>
    plausibleScriptFramePattern.test(frame.filename ?? ""),
  );
}

export function isThirdPartyClientNoise(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  const message = getErrorMessage(event, hint);

  if (thirdPartyDynamicImportFailure.test(message)) {
    return true;
  }

  if (
    thirdPartyFetchFailureIgnoreErrors.some((pattern) => pattern.test(message))
  ) {
    return true;
  }

  if (
    message.startsWith("Failed to fetch (") &&
    hasPlausibleScriptFrame(event)
  ) {
    return true;
  }

  return false;
}

export function beforeSendClientEvent(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  if (isThirdPartyClientNoise(event, hint)) {
    return null;
  }

  return event;
}
