/** How many names a room lists before it counts the rest. */
const NAMES_SHOWN = 3;

/**
 * The name a room made of people is shown under.
 *
 * Web builds the chat sidebar from this, and Core puts the same name on a
 * notification, so a mention names the room the reader already sees in the
 * list. Names arrive in the order they are shown, and a repeat stays a repeat:
 * two members called Sam are two members.
 */
export function formatParticipantNameList(names: readonly string[]): string {
  if (names.length <= NAMES_SHOWN) {
    return names.join(", ");
  }

  return `${names.slice(0, NAMES_SHOWN).join(", ")} and ${names.length - NAMES_SHOWN} more`;
}

/**
 * The order people are listed in, by the name they are shown under.
 *
 * The id breaks a tie, so two members of the same name keep one order rather
 * than swapping places between two reads. Web sorts the chat sidebar with
 * this and Core sorts a notification's copy of the same list, so the two
 * cannot disagree about who comes first.
 */
export function compareByDisplayNameThenId(
  a: { id: string; name: string },
  b: { id: string; name: string },
): number {
  const byName = a.name.localeCompare(b.name);

  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}
