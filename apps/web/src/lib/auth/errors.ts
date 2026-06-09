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
