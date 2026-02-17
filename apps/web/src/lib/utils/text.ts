/**
 * Get initials from a name string.
 * Takes the first character of each word (up to 2 characters total).
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

  return trimmedName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
