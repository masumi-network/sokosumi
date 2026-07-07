import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const INVALID_SESSION_MESSAGE = /invalid, expired or missing session/i;

const UNAUTHENTICATED_MESSAGE = /^user is not authenticated$/i;

const NEXT_ROUTER_HOOKS_MISMATCH =
  /rendered more hooks than during the previous render/i;

/**
 * Next.js masks server-thrown errors in production RSC payloads. Client-side
 * soft navigations surface them as unhandled rejections (SOKOSUMI-W on /agents,
 * /hermes) even when the server already redirected for an expired session.
 * Real render failures are still captured server-side via `onRequestError`.
 */
const MASKED_PRODUCTION_RSC_RENDER_ERROR =
  /An error occurred in the Server Components render\. The specific message is omitted in production builds/i;

/**
 * Cardano wallet browser extensions inject `cardano.bundle.js` and throw when
 * the dApp bridge is not wired (SOKOSUMI-13 on `/chat`).
 */
export const thirdPartyWalletIgnoreErrors: RegExp[] = [
  /reading 'REQUEST_ID'/,
  /Failed to connect to MetaMask/i,
  /window\.webkit\.messageHandlers/i,
];

/**
 * `nuqs` / Next.js App Router can hit the browser history rate limit during
 * rapid URL sync on chat (SOKOSUMI-PX).
 */
export const browserHistoryRateLimitIgnoreErrors: RegExp[] = [
  /Attempt to use history\.replaceState\(\) more than 100 times per 10 seconds/,
];

function getThrownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "";
}

function getThrownErrorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return "";
}

function getEventErrorMessage(event: ErrorEvent): string {
  const exceptionValue = event.exception?.values?.[0]?.value;
  if (typeof exceptionValue === "string" && exceptionValue.length > 0) {
    return exceptionValue;
  }

  if (typeof event.message === "string") {
    return event.message;
  }

  return "";
}

function getEventErrorType(event: ErrorEvent): string | undefined {
  return event.exception?.values?.[0]?.type;
}

export function isExpectedAuthRequestError(error: unknown): boolean {
  if (getThrownErrorName(error) === "UnAuthenticatedError") {
    return true;
  }

  const message = getThrownErrorMessage(error);
  return (
    UNAUTHENTICATED_MESSAGE.test(message) ||
    INVALID_SESSION_MESSAGE.test(message)
  );
}

/**
 * Chrome/Edge extension messaging bridges reject with this string when the
 * injected script is not present (password managers, grammar checkers, etc.).
 * Sentry's defaults only cover `simulateEvent`; production also reports
 * `update` (see SOKOSUMI-PM on `/oauth/consent`).
 */
export const browserExtensionIgnoreErrors: RegExp[] = [
  /Object Not Found Matching Id:\d+, MethodName:update/,
];

export const expectedClientNoiseIgnoreErrors: RegExp[] = [
  NEXT_ROUTER_HOOKS_MISMATCH,
  MASKED_PRODUCTION_RSC_RENDER_ERROR,
  ...browserExtensionIgnoreErrors,
  ...thirdPartyWalletIgnoreErrors,
  ...browserHistoryRateLimitIgnoreErrors,
];

export function isExpectedClientNoiseErrorMessage(message: string): boolean {
  return expectedClientNoiseIgnoreErrors.some((pattern) =>
    pattern.test(message),
  );
}

export function isExpectedAuthSentryEvent(event: ErrorEvent): boolean {
  const message = getEventErrorMessage(event);
  const type = getEventErrorType(event);

  if (type === "UnAuthenticatedError") {
    return true;
  }

  if (type === "CoreApiRequestError" && INVALID_SESSION_MESSAGE.test(message)) {
    return true;
  }

  return (
    UNAUTHENTICATED_MESSAGE.test(message) ||
    INVALID_SESSION_MESSAGE.test(message)
  );
}

export function beforeSendServerEvent(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  if (isExpectedAuthSentryEvent(event)) {
    return null;
  }

  return event;
}
