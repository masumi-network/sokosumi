import { Namefully } from "namefully";

export function getFallbackUserName(email: string): string {
  const normalizedEmail = email.trim();
  const [prefix] = normalizedEmail.split("@");
  const normalizedPrefix = prefix?.trim();

  return normalizedPrefix || normalizedEmail || "User";
}

export function getStoredUserName(
  name: null | string | undefined,
  email: string,
): string {
  const normalizedName = name?.trim();

  return normalizedName || getFallbackUserName(email);
}

/** Prefer trimmed name; otherwise the full email (account chrome labels). */
export function resolveAccountDisplayName(name: string, email: string): string {
  return name.trim() || email;
}

/**
 * Given name only (e.g. greetings). Uses namefully; mononyms supported.
 * Returns undefined when input is blank or unparsable.
 */
export function getFirstName(
  name: null | string | undefined,
): string | undefined {
  const normalized = name?.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }

  const parsed =
    Namefully.tryParse(normalized) ??
    (() => {
      try {
        return new Namefully(normalized, { mono: true });
      } catch {
        return undefined;
      }
    })();

  const first = parsed?.first.trim();
  return first || undefined;
}
