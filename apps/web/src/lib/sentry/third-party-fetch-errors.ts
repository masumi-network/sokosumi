import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const FIRST_PARTY_HOST_SUFFIXES = ["sokosumi.com", "localhost", "127.0.0.1"];

const THIRD_PARTY_STACK_PATTERNS = [
  /li\.lms-analytics/i,
  /plausible/i,
  /usercentrics/i,
  /googlesyndication/i,
  /googletagmanager/i,
  /frame_ant/i,
  /injectScriptAdjust/i,
  /script\.file-downloads/i,
  /px\.ads\.linkedin/i,
];

const FIRST_PARTY_STACK_PATTERNS = [
  /next\/src/i,
  /next\/dist/i,
  /_next\//i,
  /webpack:/i,
  /apps\/web/i,
  /\/src\/app\//i,
  /\/src\/lib\//i,
  /\/src\/components\//i,
  /server-action-reducer/i,
];

const FAILED_FETCH_HOST_RE = /Failed to fetch \(([^)]+)\)/;
const DYNAMIC_IMPORT_URL_RE =
  /Failed to fetch dynamically imported module:\s*(https?:\/\/\S+)/i;

export function isThirdPartyFetchNoise(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  const message = getErrorMessage(event, hint);
  if (!message?.includes("Failed to fetch")) {
    return false;
  }

  const hostFromMessage = extractFailedFetchHost(message);
  if (hostFromMessage) {
    return !isFirstPartyHost(hostFromMessage);
  }

  const moduleUrl = extractDynamicImportUrl(message);
  if (moduleUrl) {
    try {
      return !isFirstPartyHost(new URL(moduleUrl).hostname);
    } catch {
      return false;
    }
  }

  return isBareFailedFetchFromThirdPartyScriptsOnly(event, message);
}

export function sentryBeforeSend(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  if (isThirdPartyFetchNoise(event, hint)) {
    return null;
  }
  return event;
}

function getErrorMessage(
  event: ErrorEvent,
  hint: EventHint,
): string | undefined {
  const original = hint.originalException;
  if (original instanceof Error && original.message) {
    return original.message;
  }
  return event.exception?.values?.[0]?.value ?? event.message ?? undefined;
}

function extractFailedFetchHost(message: string): string | null {
  const match = message.match(FAILED_FETCH_HOST_RE);
  return match?.[1] ?? null;
}

function extractDynamicImportUrl(message: string): string | null {
  const match = message.match(DYNAMIC_IMPORT_URL_RE);
  return match?.[1] ?? null;
}

export function isFirstPartyHost(host: string): boolean {
  const normalized = host.toLowerCase().split(":")[0] ?? host;
  if (normalized.endsWith(".vercel.app")) {
    return true;
  }
  return FIRST_PARTY_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

function isBareFailedFetchFromThirdPartyScriptsOnly(
  event: ErrorEvent,
  message: string,
): boolean {
  const normalized = message.replace(/^TypeError:\s*/, "");
  if (normalized !== "Failed to fetch") {
    return false;
  }

  const frames =
    event.exception?.values?.[0]?.stacktrace?.frames?.filter(
      (frame) => frame.filename && !frame.filename.includes("@sentry"),
    ) ?? [];

  if (frames.length === 0) {
    return false;
  }

  let hasThirdPartyFrame = false;

  for (const frame of frames) {
    const filename = frame.filename ?? "";
    if (isFirstPartyStackFrame(filename)) {
      return false;
    }
    if (isThirdPartyStackFrame(filename)) {
      hasThirdPartyFrame = true;
    }
  }

  return hasThirdPartyFrame;
}

function isFirstPartyStackFrame(filename: string): boolean {
  return FIRST_PARTY_STACK_PATTERNS.some((pattern) => pattern.test(filename));
}

function isThirdPartyStackFrame(filename: string): boolean {
  return THIRD_PARTY_STACK_PATTERNS.some((pattern) => pattern.test(filename));
}
