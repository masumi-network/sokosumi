/** Matches Core / the web action: more than this is invalid input. */
export const AVATAR_EXCLUDE_CAP = 60;

/** Wrap around before the next request would exceed the exclusion cap. */
export function excludeIdsForAvatarRefresh(seen: string[]): string[] {
  return seen.length >= AVATAR_EXCLUDE_CAP ? [] : seen;
}

export function nextSeenAvatars<T>(
  previous: T[],
  returned: T[],
  usedExcludeIds: string[],
): T[] {
  return usedExcludeIds.length === 0 ? returned : [...previous, ...returned];
}

/**
 * A refresh comes back short while new avatars are still being drawn. Fill
 * the rest of the row with avatars seen before, most recent first, so the row
 * stays full and no avatar shows twice.
 */
export function fillAvatarRow<T extends { id: string }>(
  fresh: T[],
  seen: T[],
  take: number,
): T[] {
  const freshIds = new Set(fresh.map((avatar) => avatar.id));
  const filler = [...seen]
    .reverse()
    .filter((avatar) => !freshIds.has(avatar.id))
    .slice(0, Math.max(0, take - fresh.length));
  return [...fresh, ...filler];
}
