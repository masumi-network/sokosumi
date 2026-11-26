/**
 * Get initials from a name string.
 * Takes the first character of each word (up to 2 characters total), or the
 * first two characters of a single-word name. A trailing qualifier in
 * parentheses, such as "(Beta)", is left out.
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

  // A trailing qualifier such as "(Beta)" labels the name; it is not part of it.
  const base = trimmedName.replace(/\s*\([^()]*\)$/u, "") || trimmedName;
  const parts = base.split(/\s+/);
  // Array.from walks code points, so a letter outside the basic plane stays whole.
  const letters =
    parts.length === 1
      ? Array.from(parts[0]).slice(0, 2).join("")
      : parts.map((part) => Array.from(part)[0]).join("");
  return Array.from(letters.toUpperCase()).slice(0, 2).join("");
}
