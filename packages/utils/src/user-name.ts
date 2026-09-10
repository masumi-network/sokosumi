import { Namefully } from "namefully";

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
