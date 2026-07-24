import { z } from "@hono/zod-openapi";

import { forbidden } from "@/helpers/error";
import {
  type AuthenticationContext,
  hasAdminRole,
  isOrchestratorAuthContext,
  isUserAuthContext,
  requireUserContext,
  type UserAuthenticationContext,
  type UserContext,
} from "@/middleware/auth";

/** Path segment meaning "the authenticated effective user" (session or context). */
export const USERS_PATH_ME = "me" as const;

/**
 * Session-only user context (admin or self). Prefer {@link UserContext} for
 * callers that also accept orchestrator context headers.
 */
export type SessionUserContext = {
  source: "session";
} & UserAuthenticationContext;

/** OpenAPI path param: `me` or a concrete user id (see {@link resolveUsersPathUserId}). */
export const usersRoutePathUserIdSchema = z.string().openapi({
  param: { name: "id", in: "path" },
  description:
    "Pass the literal `me` for the authenticated effective user (session user, or orchestrator with X-Context-User-Id), or a user id when the caller may access that user's data.",
  example: "me",
});

/**
 * Resolves the first `/{id}` segment on user routes: `me` → effective user id;
 * otherwise enforces {@link requireAccessToTargetUserData}.
 *
 * Orchestrator with `X-Context-User-Id` may access that user's tree (path `me`
 * or matching concrete id). Coworker actors remain rejected.
 */
export function resolveUsersPathUserId(
  authContext: AuthenticationContext,
  pathUserSegment: string,
): { resolvedUserId: string; userContext: UserContext } {
  if (pathUserSegment === USERS_PATH_ME) {
    const userContext = requireEffectiveUserPathContext(authContext);
    return {
      resolvedUserId: userContext.userId,
      userContext,
    };
  }

  const userContext = requireAccessToTargetUserData(
    authContext,
    pathUserSegment,
  );
  return { resolvedUserId: pathUserSegment, userContext };
}

/**
 * Effective user for path `me` and self-id access: session user, or
 * orchestrator with context headers. Rejects coworker actors.
 */
function requireEffectiveUserPathContext(
  authContext: AuthenticationContext,
): UserContext {
  if (isUserAuthContext(authContext)) {
    return { source: "session", ...authContext };
  }

  if (isOrchestratorAuthContext(authContext)) {
    return requireUserContext(authContext);
  }

  throw forbidden("User authentication required");
}

/**
 * Ensures the caller may access or mutate data for `resolvedUserId`:
 * - session user matches `resolvedUserId`, or session user has admin role
 * - orchestrator with context whose `userId` matches `resolvedUserId`
 *
 * Coworker actors are rejected — user path data is not available to coworker keys.
 */
export function requireAccessToTargetUserData(
  authContext: AuthenticationContext,
  resolvedUserId: string,
): UserContext {
  if (isUserAuthContext(authContext)) {
    if (authContext.userId === resolvedUserId) {
      return { source: "session", ...authContext };
    }
    if (hasAdminRole(authContext.role)) {
      return { source: "session", ...authContext };
    }
    throw forbidden("You are not allowed to access this user's data");
  }

  if (isOrchestratorAuthContext(authContext)) {
    const userContext = requireUserContext(authContext);
    if (userContext.userId !== resolvedUserId) {
      throw forbidden("You are not allowed to access this user's data");
    }
    return userContext;
  }

  throw forbidden("User authentication required");
}
