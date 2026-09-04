import { createMiddleware } from "hono/factory";

import { forbidden } from "@/helpers/error";
import type { EnvVariables } from "@/lib/hono";
import { isCoworkerAuthContext, isSokoBotAuthContext } from "@/middleware/auth";

import type { UserRouteVariables } from "./user-route-context";

type UserRouteEnv = {
  Variables: EnvVariables["Variables"] & UserRouteVariables;
};

/**
 * GET subpaths under `/users/{id}` that agents may call for their owner
 * context. Everything else under the user tree stays session-only.
 * Patterns are path-only today because only GET handlers exist on these shapes;
 * do not mount mutating routes on the same paths without updating this gate.
 */
const AGENT_ALLOWED_USER_SUBPATH_PATTERNS: ReadonlyArray<RegExp> = [
  /^\/$/,
  /^\/credits$/,
  /^\/organizations$/,
  /^\/organizations\/[^/]+\/credits$/,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Path after the `/users/{id}` segment (e.g. `/credits`,
 * `/organizations/org_1/member`). Returns `/` when the request is the user
 * root (`GET /users/{id}`).
 *
 * Prefers the segment after `/users/` (API mount) so ids that collide with
 * path prefixes (e.g. `users`) or later segments (e.g. org id `me`) still
 * resolve correctly. Falls back to the first matching segment for test apps
 * mounted without the `/users` prefix.
 */
export function userRouteSubpathAfterId(
  requestPath: string,
  pathUserId: string,
): string {
  const normalized = requestPath.replace(/\/+$/, "") || "/";
  const escapedId = escapeRegExp(pathUserId);
  const usersMounted = new RegExp(`(?:^|/)users/${escapedId}(?=/|$)`);
  const usersMatch = usersMounted.exec(normalized);

  if (usersMatch) {
    const after = normalized.slice(usersMatch.index + usersMatch[0].length);
    if (after.length === 0) {
      return "/";
    }
    return after.startsWith("/") ? after : `/${after}`;
  }

  const segments = normalized.split("/").filter(Boolean);
  const idIndex = segments.findIndex((segment) => segment === pathUserId);

  if (idIndex === -1) {
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  const afterSegments = segments.slice(idIndex + 1);
  if (afterSegments.length === 0) {
    return "/";
  }
  return `/${afterSegments.join("/")}`;
}

export function isAgentAllowedUserSubpath(subpath: string): boolean {
  const normalized = subpath.replace(/\/+$/, "") || "/";
  return AGENT_ALLOWED_USER_SUBPATH_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

/**
 * Default-deny gate for agent actors on `/users/{id}/*`. This middleware keeps
 * access limited to
 * user profile, credits, and organization list/credits reads.
 */
export const agentUserRouteAllowlistMiddleware = createMiddleware<UserRouteEnv>(
  async (c, next) => {
    const { authContext } = c.var;
    if (
      !isCoworkerAuthContext(authContext) &&
      !isSokoBotAuthContext(authContext)
    ) {
      return await next();
    }

    const pathUserId = c.req.param("id");
    if (!pathUserId) {
      throw forbidden("Agent authentication cannot access this user route");
    }

    const subpath = userRouteSubpathAfterId(c.req.path, pathUserId);
    if (!isAgentAllowedUserSubpath(subpath)) {
      throw forbidden("Agent authentication cannot access this user route");
    }

    return await next();
  },
);
