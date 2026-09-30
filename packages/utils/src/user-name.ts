import { Namefully } from "namefully";

export const USER_NAME_MAX_LENGTH = 128;

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

/** The full name budget includes the space between the trimmed parts. */
export function isFirstAndLastNameWithinLimit(
  firstName: string,
  lastName: string,
): boolean {
  return (
    joinFirstAndLastName(firstName, lastName).length <= USER_NAME_MAX_LENGTH
  );
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
