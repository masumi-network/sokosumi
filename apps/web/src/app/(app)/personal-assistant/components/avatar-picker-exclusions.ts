/**
 * A refresh comes back short when the hourly cap leaves fewer to draw. Fill
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
