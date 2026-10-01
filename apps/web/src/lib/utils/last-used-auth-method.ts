export type LastUsedAuthMethod =
  | "google"
  | "microsoft"
  | "passkey"
  | "email-otp"
  | "email";

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
