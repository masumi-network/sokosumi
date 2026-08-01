/**
 * Mirrors Core `parseDirectCreateShape` predicates for web-side validation
 * before calling create/send direct actions. Messages match Core when possible.
 */
export function directCreateShapeError(
  memberUserIds: readonly string[],
  coworkerIds: readonly string[],
): string | null {
  if (memberUserIds.length === 0 && coworkerIds.length === 0) {
    return "Choose a direct message target";
  }

  if (memberUserIds.length > 0 && coworkerIds.length > 0) {
    return "Group direct messages cannot include coworkers.";
  }

  if (coworkerIds.length > 1) {
    return "Direct messages support one coworker only.";
  }

  if (memberUserIds.length >= 1 && coworkerIds.length === 0) {
    return null;
  }

  if (memberUserIds.length === 0 && coworkerIds.length === 1) {
    return null;
  }

  return "Choose a direct message target";
}
