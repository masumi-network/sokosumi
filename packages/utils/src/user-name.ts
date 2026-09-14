/** Prefer trimmed name; otherwise the full email (account chrome labels). */
export function resolveAccountDisplayName(name: string, email: string): string {
  return name.trim() || email;
}

/**
 * Given name only (e.g. greetings). First whitespace-separated token.
 * Returns undefined when input is blank.
 */
export function getFirstName(
  name: null | string | undefined,
): string | undefined {
  const normalized = name?.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }

  return normalized.split(" ")[0] || undefined;
}
