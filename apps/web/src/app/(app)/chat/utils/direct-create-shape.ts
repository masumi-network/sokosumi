/**
 * Mirrors Core `parseDirectCreateShape` predicates for web-side validation
 * before calling create/send direct actions. Messages match Core when possible.
 */
export function directCreateShapeError(
  memberUserIds: readonly string[],
  coworkerIds: readonly string[],
  orchestratorIds: readonly string[] = [],
): string | null {
  const targetKinds = [
    memberUserIds.length > 0,
    coworkerIds.length > 0,
    orchestratorIds.length > 0,
  ].filter(Boolean).length;

  if (targetKinds === 0) {
    return "Choose a direct message target";
  }

  if (targetKinds > 1) {
    return "Direct messages cannot mix humans, coworkers, and personal assistants.";
  }

  if (coworkerIds.length > 1) {
    return "Direct messages support one coworker only.";
  }

  if (orchestratorIds.length > 1) {
    return "Direct messages support one personal assistant only.";
  }

  return null;
}
