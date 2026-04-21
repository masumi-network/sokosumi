import { z } from "@hono/zod-openapi";

import { forbidden } from "@/helpers/error";
import {
  type AuthenticationContext,
  hasAdminRole,
  requireUserAuthContext,
  requireUserContext,
  type UserContext,
} from "@/middleware/auth";

/** Path segment meaning "the authenticated session user" (Better Auth only). */
export const USERS_PATH_ME = "me" as const;

/** OpenAPI path param: `me` or a concrete user id (see {@link resolveUsersPathUserId}). */
export const usersRoutePathUserIdSchema = z.string().openapi({
  param: { name: "id", in: "path" },
  description:
    "Pass the literal `me` for the authenticated session user, or a user id when the caller may access that user's data.",
  example: "me",
});

/**
 * Resolves the first `/{id}` segment on user routes: `me` → session user id and
 * session-only auth; otherwise enforces {@link requireAccessToTargetUserData}.
 */
export function resolveUsersPathUserId(
  authContext: AuthenticationContext,
  pathUserSegment: string,
): { resolvedUserId: string; userContext: UserContext } {
  if (pathUserSegment === USERS_PATH_ME) {
    const session = requireUserAuthContext(authContext);
    return {
      resolvedUserId: session.userId,
      userContext: { source: "session", ...session },
    };
  }

  const userContext = requireAccessToTargetUserData(
    authContext,
    pathUserSegment,
  );
  return { resolvedUserId: pathUserSegment, userContext };
}

/**
 * Ensures the caller may access or mutate data for `resolvedUserId`: the effective
 * user (session or delegated coworker) matches `resolvedUserId`, or the caller is a
 * session user with an admin role.
 */
export function requireAccessToTargetUserData(
  authContext: AuthenticationContext,
  resolvedUserId: string,
): UserContext {
  const userContext = requireUserContext(authContext);
  if (userContext.userId === resolvedUserId) {
    return userContext;
  }
  if (userContext.source === "session" && hasAdminRole(userContext.role)) {
    return userContext;
  }
  throw forbidden("You are not allowed to access this user's data");
}
