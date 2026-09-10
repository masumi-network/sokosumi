export class UnAuthenticatedError extends Error {
  public readonly redirectUrl?: string;

  constructor(redirectUrl?: string, message = "User is not authenticated") {
    super(message);
    this.name = "UnAuthenticatedError";
    this.cause = "UNAUTHENTICATED";
    this.redirectUrl = redirectUrl;
  }
}

export function isUnAuthenticatedError(
  error: unknown,
): error is UnAuthenticatedError {
  return error instanceof UnAuthenticatedError;
}

export class AdminAccessRequiredError extends Error {
  constructor(message = "Admin access required") {
    super(message);
    this.name = "AdminAccessRequiredError";
    this.cause = "UNAUTHORIZED";
  }
}

export function isAdminAccessRequiredError(
  error: unknown,
): error is AdminAccessRequiredError {
  return error instanceof AdminAccessRequiredError;
}

/**
 * The session could not be read, so we do not know whether the user is signed
 * in. Distinct from `UnAuthenticatedError` on purpose: the error boundary
 * redirects that one to /signin, which is the wrong answer for a Core stall -
 * it reads as a logout to a user whose session is fine and throws away what
 * they were doing. This one falls through to the normal retryable error UI.
 */
export class CoreAuthUnavailableError extends Error {
  public readonly reason: string;

  constructor(reason: string, message = "Session could not be read") {
    super(message);
    this.name = "CoreAuthUnavailableError";
    this.cause = "CORE_AUTH_UNAVAILABLE";
    this.reason = reason;
  }
}

export function isCoreAuthUnavailableError(
  error: unknown,
): error is CoreAuthUnavailableError {
  return error instanceof CoreAuthUnavailableError;
}
