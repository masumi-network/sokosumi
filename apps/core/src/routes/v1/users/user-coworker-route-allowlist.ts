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
 * context, with the path the 403 names. Everything else under the user tree,
 * and every other method on these paths (such as `PATCH /users/{id}`), stays
 * session-only.
 */
const AGENT_ALLOWED_USER_SUBPATHS: ReadonlyArray<{
  pattern: RegExp;
  path: string;
}> = [
  { pattern: /^\/$/, path: "/users/{id}" },
  { pattern: /^\/credits$/, path: "/users/{id}/credits" },
  { pattern: /^\/organizations$/, path: "/users/{id}/organizations" },
  {
    pattern: /^\/organizations\/[^/]+\/credits$/,
    path: "/users/{id}/organizations/{organizationId}/credits",
  },
  { pattern: /^\/workspaces$/, path: "/users/{id}/workspaces" },
];

/** Names what an agent may call, so a 403 says what to do instead. */
function agentUserRouteForbidden(actor: "coworker" | "sokoBot") {
  const paths = AGENT_ALLOWED_USER_SUBPATHS.map(({ path }) => path);
  const keys = actor === "coworker" ? "Coworker keys" : "Soko Bot keys";
  return forbidden(
    `${keys} may only GET ${paths.slice(0, -1).join(", ")} and ${paths.at(-1)}`,
  );
}

/**
 * Allowlisted subpaths whose handler narrows its result to the workspaces the
 * agent may act in, so the agent is not bound to one context workspace first.
 * Listing workspaces is how a coworker finds the organization to send.
 */
const AGENT_SELF_FILTERING_USER_SUBPATH_PATTERNS: ReadonlyArray<RegExp> = [
  /^\/workspaces$/,
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

export function isAgentSelfFilteringUserSubpath(subpath: string): boolean {
  const normalized = subpath.replace(/\/+$/, "") || "/";
  return AGENT_SELF_FILTERING_USER_SUBPATH_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

export function isAgentAllowedUserSubpath(subpath: string): boolean {
  const normalized = subpath.replace(/\/+$/, "") || "/";
  return AGENT_ALLOWED_USER_SUBPATHS.some(({ pattern }) =>
    pattern.test(normalized),
  );
}

/**
 * Default-deny gate for agent actors on `/users/{id}/*`. This middleware keeps
 * access limited to
 * user profile, credits, organization list/credits, and workspace list reads.
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
      throw agentUserRouteForbidden(authContext.actor);
    }

    const subpath = userRouteSubpathAfterId(c.req.path, pathUserId);
    if (c.req.method !== "GET" || !isAgentAllowedUserSubpath(subpath)) {
      throw agentUserRouteForbidden(authContext.actor);
    }

    return await next();
  },
);
