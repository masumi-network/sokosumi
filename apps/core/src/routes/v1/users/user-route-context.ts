import { createMiddleware } from "hono/factory";

import { assertCoworkerUserContextBinding } from "@/helpers/coworker-user-context-binding";
import { internalServerError, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import type { UserContext } from "@/middleware/auth";

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
 * {@link assertCoworkerUserContextBinding}).
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
    if (authContext.actor === "coworker") {
      await assertCoworkerUserContextBinding(authContext, userContext, prisma);
    }

    c.set("userRouteContext", {
      resolvedUserId,
      userContext,
    });

    return await next();
  },
);
