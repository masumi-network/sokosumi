export type LastUsedAuthMethod =
  | "google"
  | "microsoft"
  | "magic-link"
  | "email";

export function parseLastUsedAuthMethod(
  value?: string,
): LastUsedAuthMethod | null {
  if (
    value === "google" ||
    value === "microsoft" ||
    value === "magic-link" ||
    value === "email"
  ) {
    return value;
  }

  return null;
}
