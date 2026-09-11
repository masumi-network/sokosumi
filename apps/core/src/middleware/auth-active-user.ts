/**
 * The one authoritative "may this user authenticate at all" check.
 *
 * Every bearer path has to run it, because banning or deleting a user only
 * clears their sessions: Better Auth's admin plugin deletes session rows and
 * refuses to create new ones, but it never touches API keys or OAuth tokens.
 * Without this check a banned user keeps every bearer credential they held,
 * and a deleted user keeps API keys forever (`Apikey.referenceId` is a plain
 * string with no relation to `User`, so deletion cascades nothing).
 *
 * The check is a predicate over already-selected columns rather than its own
 * query, so each caller folds it into the user lookup it was making anyway.
 */

/**
 * Columns every bearer path selects for its user: `role` for the auth context
 * it builds, `banned` and `banExpires` for {@link isActiveUser}.
 */
export const BEARER_USER_SELECT = {
  role: true,
  banned: true,
  banExpires: true,
} as const;

export interface ActiveUserCandidate {
  banned: boolean | null;
  banExpires: Date | null;
}

/**
 * Narrows a looked-up user to one that may authenticate.
 *
 * Rejects a missing user, and rejects an active ban. A ban whose `banExpires`
 * has passed is not an active ban: Better Auth treats it as lifted and clears
 * it on the next session creation. This read path matches that meaning but
 * does not write, so the row is left for Better Auth to clear.
 *
 * The boundary follows Better Auth rather than SOK-997, which worded an active
 * ban as `banExpires` "null or in the future". A `banExpires` of exactly now is
 * in neither, and Better Auth's `new Date(banExpires).getTime() < Date.now()`
 * keeps the ban. Diverging would make one instant a ban here and a lifted ban
 * on the next sign-in.
 */
export function isActiveUser<T extends ActiveUserCandidate>(
  user: T | null | undefined,
  now: Date = new Date(),
): user is T {
  if (!user) {
    return false;
  }

  if (!user.banned) {
    return true;
  }

  return user.banExpires !== null && user.banExpires.getTime() < now.getTime();
}
