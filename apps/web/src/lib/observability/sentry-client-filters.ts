import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const BLOCKED_THIRD_PARTY_FETCH_HOSTS = [
  "plausible.io",
  "pagead2.googlesyndication.com",
  "region1.google-analytics.com",
  "analytics.google.com",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "usercentrics.eu",
] as const;

const THIRD_PARTY_STACK_PATTERNS = [
  /plausible\.io/i,
  /script\.file-downloads\.hash\.outbound-links/i,
  /usercentrics\.eu/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /googlesyndication\.com/i,
  /injectScriptAdjust\.js/i,
  /frame_ant\.js/i,
] as const;

function hostMatchesBlockedList(host: string): boolean {
  const normalized = host.toLowerCase();
  return BLOCKED_THIRD_PARTY_FETCH_HOSTS.some(
    (blocked) => normalized === blocked || normalized.endsWith(`.${blocked}`),
  );
}

export function getFailedFetchHost(message: string): string | null {
  const dynamicImportMatch = /dynamically imported module:\s*(\S+)/i.exec(
    message,
  );
  if (dynamicImportMatch) {
    const urlMatch = /^https?:\/\/([^/]+)/i.exec(dynamicImportMatch[1]);
    return urlMatch?.[1] ?? null;
  }

  const hostInParens = /\(([^)]+)\)\s*$/.exec(message);
  return hostInParens?.[1] ?? null;
}

export function isThirdPartyFetchNoise(message: string): boolean {
  if (!message.includes("Failed to fetch")) {
    return false;
  }

  const host = getFailedFetchHost(message);
  if (!host) {
    return false;
  }

  return hostMatchesBlockedList(host);
}

function stackFramesOnlyThirdParty(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  if (frames.length === 0) {
    return false;
  }

  const relevantFrames = frames.filter(
    (frame) => !frame.filename?.includes("@sentry"),
  );

  if (relevantFrames.some((frame) => frame.in_app)) {
    return false;
  }

  return relevantFrames.some((frame) => {
    const location = `${frame.filename ?? ""} ${frame.abs_path ?? ""}`;
    return THIRD_PARTY_STACK_PATTERNS.some((pattern) => pattern.test(location));
  });
}

function getErrorMessage(event: ErrorEvent, hint?: EventHint): string {
  const original = hint?.originalException;
  if (original instanceof Error) {
    return original.message;
  }

  return event.exception?.values?.[0]?.value ?? event.message ?? "";
}

export function shouldDropClientSentryEvent(
  event: ErrorEvent,
  hint?: EventHint,
): boolean {
  const message = getErrorMessage(event, hint);

  if (isThirdPartyFetchNoise(message)) {
    return true;
  }

  if (message.includes("Failed to fetch") && stackFramesOnlyThirdParty(event)) {
    return true;
  }

  return false;
}
