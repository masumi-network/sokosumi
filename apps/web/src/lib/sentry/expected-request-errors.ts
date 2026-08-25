import type { ErrorEvent, EventHint } from "@sentry/nextjs";

import { isStaleDeploymentError } from "@/lib/utils/deployment-refresh";

const INVALID_SESSION_MESSAGE = /invalid, expired or missing session/i;

const UNAUTHENTICATED_MESSAGE = /^user is not authenticated$/i;

const NEXT_ROUTER_HOOKS_MISMATCH =
  /rendered more hooks than during the previous render/i;

/** Next.js masks real RSC failures in production; the client surfaces them as
 * unhandled rejections without actionable detail (SOKOSUMI-W on `/agents`). */
export const MASKED_PRODUCTION_RSC_RENDER_ERROR =
  /an error occurred in the server components render/i;

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

function getEventTransaction(event: ErrorEvent): string {
  if (typeof event.transaction === "string") {
    return event.transaction;
  }

  const tagTransaction = event.tags?.transaction;
  return typeof tagTransaction === "string" ? tagTransaction : "";
}

/**
 * Web removed its local Better Auth handler in #3194; `/api/auth/*` now proxies
 * to Core. Preview deployments still on the old handler (or bots replaying the
 * path) can throw Prisma auth DB errors (SOKOSUMI-Q0).
 */
export function isLegacyWebAuthPrismaNoise(event: ErrorEvent): boolean {
  if (getEventErrorType(event) !== "PrismaClientKnownRequestError") {
    return false;
  }

  return getEventTransaction(event).includes("/api/auth/");
}

interface CoreApiRequestErrorShape {
  name: string;
  status?: number;
}

function isCoreApiRequestError(
  error: unknown,
): error is CoreApiRequestErrorShape {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as CoreApiRequestErrorShape).name === "CoreApiRequestError"
  );
}

function isClientErrorHttpStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401;
}

/**
 * User-facing Core API validation/conflict responses rethrown from server
 * actions (SOKOSUMI-PY, SOKOSUMI-GT, SOKOSUMI-KP on `POST /tasks/[taskId]`).
 */
const expectedBusinessErrorMessages: RegExp[] = [
  /cannot move a task with related tasks/i,
];

export function isExpectedBusinessRequestError(error: unknown): boolean {
  if (
    isCoreApiRequestError(error) &&
    typeof error.status === "number" &&
    isClientErrorHttpStatus(error.status)
  ) {
    return true;
  }

  const message = getThrownErrorMessage(error);
  return expectedBusinessErrorMessages.some((pattern) => pattern.test(message));
}

export function isExpectedBusinessSentryEvent(event: ErrorEvent): boolean {
  const message = getEventErrorMessage(event);
  const type = getEventErrorType(event);

  if (type === "CoreApiRequestError") {
    const statusTag = event.tags?.["http.status_code"];
    const statusFromTag =
      typeof statusTag === "string"
        ? Number.parseInt(statusTag, 10)
        : undefined;
    if (
      typeof statusFromTag === "number" &&
      isClientErrorHttpStatus(statusFromTag)
    ) {
      return true;
    }
  }

  return expectedBusinessErrorMessages.some((pattern) => pattern.test(message));
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
];

export function isMaskedProductionRscRenderError(message: string): boolean {
  return MASKED_PRODUCTION_RSC_RENDER_ERROR.test(message);
}

export function isExpectedClientNoiseErrorMessage(message: string): boolean {
  if (isStaleDeploymentError(message)) {
    return true;
  }
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
  if (
    isExpectedAuthSentryEvent(event) ||
    isExpectedBusinessSentryEvent(event) ||
    isLegacyWebAuthPrismaNoise(event)
  ) {
    return null;
  }

  return event;
}
