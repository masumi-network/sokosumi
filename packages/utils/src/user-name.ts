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

/** Roster / coworker caption for a personal assistant owned by `ownerName`. */
export function personalAssistantCaption(
  ownerName: null | string | undefined,
): string {
  const ownerFirstName = getFirstName(ownerName);
  return ownerFirstName
    ? `${ownerFirstName}'s personal assistant`
    : "Personal assistant";
}
