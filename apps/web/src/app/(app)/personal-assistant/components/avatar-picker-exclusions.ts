/** Matches Core / the web action: more than this is invalid input. */
export const AVATAR_EXCLUDE_CAP = 60;

/** Wrap around before the next request would exceed the exclusion cap. */
export function excludeIdsForAvatarRefresh(seen: string[]): string[] {
  return seen.length >= AVATAR_EXCLUDE_CAP ? [] : seen;
}

export function nextSeenAvatarIds(
  previous: string[],
  returnedIds: string[],
  usedExcludeIds: string[],
): string[] {
  return usedExcludeIds.length === 0
    ? returnedIds
    : [...previous, ...returnedIds];
}
