import { z } from "@hono/zod-openapi";

import { forbidden } from "@/helpers/error";
import {
  type AuthenticationContext,
  hasAdminRole,
  requireUserAuthContext,
  type UserAuthenticationContext,
} from "@/middleware/auth";

/** Path segment meaning "the authenticated session user" (Better Auth only). */
export const USERS_PATH_ME = "me" as const;

/** Session-only user context returned from user-path access checks. */
export type SessionUserContext = {
  source: "session";
} & UserAuthenticationContext;

/** OpenAPI path param: `me` or a concrete user id (see {@link resolveUsersPathUserId}). */
export const usersRoutePathUserIdSchema = z.string().openapi({
  param: { name: "id", in: "path" },
  description:
    "Pass the literal `me` for the authenticated session user, or a user id when the session caller may access that user's data.",
  example: "me",
});

/**
 * Resolves the first `/{id}` segment on user routes: `me` → session user id and
 * session-only auth; otherwise enforces {@link requireAccessToTargetUserData}.
 */
export function resolveUsersPathUserId(
  authContext: AuthenticationContext,
  pathUserSegment: string,
): { resolvedUserId: string; userContext: SessionUserContext } {
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
 * Ensures the caller may access or mutate data for `resolvedUserId`: the
 * session user matches `resolvedUserId`, or the session user has an admin role.
 * Coworker and orchestrator actors are rejected — user path data is session-only.
 */
export function requireAccessToTargetUserData(
  authContext: AuthenticationContext,
  resolvedUserId: string,
): SessionUserContext {
  const session = requireUserAuthContext(authContext);
  if (session.userId === resolvedUserId) {
    return { source: "session", ...session };
  }
  if (hasAdminRole(session.role)) {
    return { source: "session", ...session };
  }
  throw forbidden("You are not allowed to access this user's data");
}
