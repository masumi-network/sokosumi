import { createMiddleware } from "hono/factory";

import { assertCoworkerUserContextBinding } from "@/helpers/coworker-user-context-binding";
import { internalServerError, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import type { UserContext } from "@/middleware/auth";

import {
  agentUserRouteAllowlistMiddleware,
  isAgentSelfFilteringUserSubpath,
  userRouteSubpathAfterId,
} from "./user-coworker-route-allowlist";
import { resolveUsersPathUserId } from "./user-path-access";

export interface UserRouteContext {
  resolvedUserId: string;
  userContext: UserContext;
}

export interface UserRouteVariables {
  userRouteContext: UserRouteContext | null;
}

type UserRouteEnv = {
  Variables: EnvVariables["Variables"] & UserRouteVariables;
};

export function requireUserRouteContext(
  userRouteContext: UserRouteContext | null,
): UserRouteContext {
  if (!userRouteContext) {
    throw internalServerError("User route context is missing");
  }

  return userRouteContext;
}

/**
 * Resolves and validates the target user context for `/users/{id}` routes.
 * Coworkers must have a workspace grant or baseline task relationship to the
 * context user before any user-tree handler runs (see
 * {@link assertCoworkerUserContextBinding}), except on routes that narrow their
 * own result to the workspaces the coworker may act in.
 */
export const usersPathUserContextMiddleware = createMiddleware<UserRouteEnv>(
  async (c, next) => {
    const pathUser = c.req.param("id");

    if (!pathUser) {
      throw notFound("User ID is required");
    }

    const { resolvedUserId, userContext } = resolveUsersPathUserId(
      c.var.authContext,
      pathUser,
    );
    const user = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      select: { id: true },
    });

    if (!user) {
      throw notFound("User not found");
    }

    const authContext = c.var.authContext;
    if (
      authContext.actor === "coworker" &&
      !isAgentSelfFilteringUserSubpath(
        userRouteSubpathAfterId(c.req.path, pathUser),
      )
    ) {
      await assertCoworkerUserContextBinding(authContext, userContext, prisma);
    }

    c.set("userRouteContext", {
      resolvedUserId,
      userContext,
    });

    return await next();
  },
);

/**
 * The middleware every `/users/{id}` route runs, in order. The allowlist goes
 * first: an agent on a route it may not call gets 403 before any
 * context-workspace error that would only send it elsewhere. Route tests
 * mount this too, so they exercise the stack production runs.
 */
export function applyUserRouteMiddleware(
  app: OpenAPIHonoWithAuth<UserRouteVariables>,
): void {
  app.use("*", agentUserRouteAllowlistMiddleware);
  app.use("*", usersPathUserContextMiddleware);
}
