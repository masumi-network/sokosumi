/**
 * The name a direct room reads under: the people in it, listed.
 *
 * A direct room has no name of its own, so it is named after who is in it.
 * Past three the list is cut, because a sidebar row and a notification line
 * both have one line to spend and a name that wraps says less than a count.
 *
 * Who is in the list is the caller's decision, and it differs by surface: the
 * roster a reader is shown leaves the reader out, while the name stored when
 * the room is created cannot leave anyone out because it belongs to no reader.
 */
export function buildDirectRoomName(names: readonly string[]): string {
  const cleanNames = [
    ...new Set(names.map((name) => name.trim()).filter(Boolean)),
  ];

  if (cleanNames.length === 0) {
    return "Direct message";
  }

  if (cleanNames.length <= 3) {
    return cleanNames.join(", ");
  }

  return `${cleanNames.slice(0, 3).join(", ")} and ${cleanNames.length - 3} more`;
}
