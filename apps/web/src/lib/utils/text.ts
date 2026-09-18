/**
 * Get initials from a name string.
 * Takes the first character of each word (up to 2 characters total), or the
 * first two characters of a single-word name.
 *
 * @param name - The name to extract initials from
 * @returns The initials in uppercase (max 2 characters), or "?" if the name is empty
 *
 * @example
 * getInitials("John Doe") // "JD"
 * getInitials("Jane") // "JA"
 * getInitials("") // "?"
 */
export function getInitials(name: string): string {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return "?";
  }

  const parts = trimmedName.split(/\s+/);
  const letters =
    parts.length === 1
      ? parts[0].slice(0, 2)
      : parts.map((part) => part[0]).join("");
  return letters.toUpperCase().slice(0, 2);
}
