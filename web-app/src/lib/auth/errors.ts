export class UnAuthorizedError extends Error {
  public readonly redirectUrl?: string;

  constructor(redirectUrl?: string, message = "User is not authenticated") {
    super(message);
    this.name = "UnAuthorizedError";
    this.cause = "UNAUTHORIZED";
    this.redirectUrl = redirectUrl;
  }
}

export function isUnAuthorizedError(
  error: unknown,
): error is UnAuthorizedError {
  return error instanceof UnAuthorizedError;
}
