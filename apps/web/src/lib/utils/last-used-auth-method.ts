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
export function toProviderAuthMethod(
  method: LastUsedAuthMethod | null,
): ProviderAuthMethod | null {
  return method === "email" || method === "email-otp" ? null : method;
}
