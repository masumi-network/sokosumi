import { createMiddleware } from "hono/factory";

import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { AuthEnv } from "@/middleware/auth";

import { resolveUsersPathUserId } from "./user-path-access";

/**
 * Verifies that the target user for `/users/{id}` routes exists.
 */
export const usersPathUserExistsMiddleware = createMiddleware<AuthEnv>(
  async (c, next) => {
    const pathUser = c.req.param("id");

    if (!pathUser) {
      throw notFound("User ID is required");
    }

    const { targetUserId } = resolveUsersPathUserId(
      c.var.authContext,
      pathUser,
    );
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });

    if (!user) {
      throw notFound("User not found");
    }

    return await next();
  },
);
