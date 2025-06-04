export class UnAuthorizedError extends Error {
  public readonly redirectUrl?: string;

  constructor(redirectUrl?: string, message = "User is not authenticated") {
    super(message);
    this.name = "UnAuthorizedError";
    this.cause = "UNAUTHORIZED";
    this.redirectUrl = redirectUrl;
  }
}
