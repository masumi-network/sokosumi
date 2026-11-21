import { createRoute, z } from "@hono/zod-openapi";

import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type AuthenticationContext,
  requireInteractiveUserAuthContext,
  type UserAuthenticationContext,
} from "@/middleware/auth";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

const userSessionSchema = z
  .object({
    id: z.string(),
    userAgent: z.string().nullable(),
    createdAt: z.string().datetime(),
    current: z.boolean(),
  })
  .openapi("UserSession");

const userSessionsSchema = z
  .object({ sessions: z.array(userSessionSchema) })
  .openapi("UserSessions");

const route = createRoute({
  method: "get",
  path: "/sessions",
  description:
    "List the signed-in browser sessions of the caller (path `me`), newest first. Interactive sessions only; tokens are never returned.",
  tags: ["Users"],
  request: { params: z.object({ id: usersRoutePathUserIdSchema }) },
  responses: {
    200: jsonSuccessResponse(userSessionsSchema, "Signed-in sessions"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

/** The caller's own interactive session; another user's sessions are never listed or revoked. */
export function requireOwnSession(
  authContext: AuthenticationContext,
  userRouteContext: UserRouteContext | null,
): UserAuthenticationContext {
  const auth = requireInteractiveUserAuthContext(authContext);
  const { resolvedUserId } = requireUserRouteContext(userRouteContext);
  if (resolvedUserId !== auth.userId) {
    throw forbidden("You can only manage your own sessions");
  }
  return auth;
}

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const auth = requireOwnSession(c.var.authContext, c.var.userRouteContext);
    const sessions = await prisma.session.findMany({
      where: { userId: auth.userId, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    return ok(
      c,
      userSessionsSchema.parse({
        sessions: sessions.map((session) => ({
          id: session.id,
          userAgent: session.userAgent ?? null,
          createdAt: session.createdAt.toISOString(),
          current: session.id === auth.sessionId,
        })),
      }),
    );
  });
}
