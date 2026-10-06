export type LastUsedAuthMethod =
  | "google"
  | "microsoft"
  | "passkey"
  | "email-otp"
  | "email";

/** The methods with a button of their own beside the email. */
export type ProviderAuthMethod = Extract<
  LastUsedAuthMethod,
  "google" | "microsoft" | "passkey"
>;

export function parseLastUsedAuthMethod(
  value?: string,
): LastUsedAuthMethod | null {
  if (
    value === "google" ||
    value === "microsoft" ||
    value === "passkey" ||
    value === "email-otp" ||
    value === "email"
  ) {
    return value;
  }

  return null;
}

/** Better Auth names a password sign-in `email` and a code `email-otp`. */
export function isEmailAuthMethod(
  method: LastUsedAuthMethod | null,
): method is "email" | "email-otp" {
  return method === "email" || method === "email-otp";
}

/** How the second step of Log in signs in with an email. */
export type SignInMethod = "code" | "password";

/**
 * Where Log in's second step opens. A password person is not emailed a code
 * they will not use. A code also removes the password of an account whose
 * address is unproven (`revokeUnprovenAccountAccess`), so an account with a
 * password always opens on it: the cookie belongs to the browser, not the
 * account.
 */
export function chooseSignInMethod(
  lastUsedMethod: LastUsedAuthMethod | null,
  account: { hasPassword: boolean },
): SignInMethod {
  return lastUsedMethod === "email" || account.hasPassword
    ? "password"
    : "code";
}
