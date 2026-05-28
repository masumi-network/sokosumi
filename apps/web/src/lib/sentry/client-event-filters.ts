import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const FIRST_PARTY_HOST_SUFFIX = "sokosumi.com";

const THIRD_PARTY_SCRIPT_URL_PATTERN =
  /plausible\.io|googletagmanager\.com|google-analytics\.com|analytics\.google\.com|googlesyndication\.com|usercentrics\.eu|px\.ads\.linkedin\.com|injectScriptAdjust\.js|frame_ant\.js/i;

function normalizeErrorMessage(message: string): string {
  return message.replace(/^TypeError:\s*/, "");
}

function getFetchFailureHost(message: string): string | null {
  const match = /^Failed to fetch \(([^)]+)\)$/.exec(
    normalizeErrorMessage(message),
  );
  return match?.[1] ?? null;
}

function isFirstPartyHost(host: string): boolean {
  return (
    host === FIRST_PARTY_HOST_SUFFIX ||
    host.endsWith(`.${FIRST_PARTY_HOST_SUFFIX}`)
  );
}

export function isThirdPartyFetchFailure(message: string): boolean {
  const host = getFetchFailureHost(message);
  if (!host) {
    return false;
  }

  return !isFirstPartyHost(host);
}

export function isThirdPartyDynamicImportFailure(message: string): boolean {
  const normalizedMessage = normalizeErrorMessage(message);

  return (
    normalizedMessage.startsWith(
      "Failed to fetch dynamically imported module:",
    ) && !normalizedMessage.includes("sokosumi.com")
  );
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return null;
}

export function shouldDropClientSentryEvent(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  const messages = [
    getErrorMessage(hint.originalException),
    event.exception?.values?.[0]?.value ?? null,
  ].filter((message): message is string => message !== null);

  for (const message of messages) {
    if (isThirdPartyFetchFailure(message)) {
      return true;
    }

    if (isThirdPartyDynamicImportFailure(message)) {
      return true;
    }
  }

  return false;
}

export const sentryClientDenyUrls = [THIRD_PARTY_SCRIPT_URL_PATTERN];
