import { createMiddleware } from "hono/factory";

import { forbidden } from "@/helpers/error";
import type { EnvVariables } from "@/lib/hono";
import { isCoworkerAuthContext } from "@/middleware/auth";

import type { UserRouteVariables } from "./user-route-context";

type UserRouteEnv = {
  Variables: EnvVariables["Variables"] & UserRouteVariables;
};

/**
 * Subpaths under `/users/{id}` that coworkers may call with context headers.
 * Everything else under the user tree stays session/orchestrator-only.
 */
const COWORKER_ALLOWED_USER_SUBPATH_PATTERNS: ReadonlyArray<RegExp> = [
  /^\/credits$/,
  /^\/organizations$/,
  /^\/organizations\/[^/]+\/credits$/,
  /^\/organizations\/[^/]+\/member$/,
];

/**
 * Path after the `/users/{id}` segment (e.g. `/credits`,
 * `/organizations/org_1/member`). Returns `/` when the request is the user
 * root (`GET /users/{id}`).
 */
export function userRouteSubpathAfterId(
  requestPath: string,
  pathUserId: string,
): string {
  const normalized = requestPath.replace(/\/+$/, "") || "/";
  const marker = `/${pathUserId}`;
  const markerIndex = normalized.indexOf(marker);

  if (markerIndex === -1) {
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  const after = normalized.slice(markerIndex + marker.length);
  if (after.length === 0) {
    return "/";
  }
  return after.startsWith("/") ? after : `/${after}`;
}

export function isCoworkerAllowedUserSubpath(subpath: string): boolean {
  const normalized = subpath.replace(/\/+$/, "") || "/";
  return COWORKER_ALLOWED_USER_SUBPATH_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

/**
 * Default-deny gate for coworker actors on `/users/{id}/*`. Path resolution
 * may accept coworker + context; this middleware keeps access limited to
 * credits and organization membership reads.
 */
export const coworkerUserRouteAllowlistMiddleware =
  createMiddleware<UserRouteEnv>(async (c, next) => {
    const { authContext } = c.var;
    if (!isCoworkerAuthContext(authContext)) {
      return await next();
    }

    const pathUserId = c.req.param("id");
    if (!pathUserId) {
      throw forbidden("Coworker authentication cannot access this user route");
    }

    const subpath = userRouteSubpathAfterId(c.req.path, pathUserId);
    if (!isCoworkerAllowedUserSubpath(subpath)) {
      throw forbidden("Coworker authentication cannot access this user route");
    }

    return await next();
  });
