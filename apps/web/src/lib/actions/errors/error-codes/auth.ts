export enum AuthErrorCode {
  TERMS_NOT_ACCEPTED = "TERMS_NOT_ACCEPTED",
  // Better Auth's refusal of a wrong address or password.
  INVALID_EMAIL_OR_PASSWORD = "INVALID_EMAIL_OR_PASSWORD",
  // Better Auth's sign-up refusal for an address that has an account.
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL = "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
}
