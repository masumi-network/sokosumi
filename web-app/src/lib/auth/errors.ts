export class UnAuthorizedError extends Error {
  constructor(message = "User is not authenticated") {
    super(message);
    this.name = "UnAuthorizedError";
    this.cause = "UNAUTHORIZED";
  }
}

export function isUnAuthorizedError(
  error: unknown,
): error is UnAuthorizedError {
  return error instanceof UnAuthorizedError;
}
