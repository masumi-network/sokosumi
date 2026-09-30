import { Namefully } from "namefully";

export function userHasLegacyName(
  name: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): boolean {
  // New auth records default missing parts to "". Only legacy rows retain
  // both null parts; their existing display name needs no backfill.
  return Boolean(name?.trim()) && firstName == null && lastName == null;
}

/** Prefer trimmed name; otherwise the full email (account chrome labels). */
export function resolveAccountDisplayName(name: string, email: string): string {
  return name.trim() || email;
}

/** Display name a user starts with: first and last name, trimmed. */
export function joinFirstAndLastName(
  firstName: string,
  lastName: string,
): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
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
