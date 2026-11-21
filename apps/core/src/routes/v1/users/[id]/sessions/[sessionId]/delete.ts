import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import type { UserRouteVariables } from "@/routes/v1/users/user-route-context";

import { requireOwnSession } from "../get";

const params = z.object({
  id: usersRoutePathUserIdSchema,
  sessionId: z.string().openapi({
    param: { name: "sessionId", in: "path" },
    description: "Session ID from the sessions list",
  }),
});

const revokeUserSessionResponseSchema = z.object({});

const route = createRoute({
  method: "delete",
  path: "/sessions/{sessionId}",
  description:
    "Sign out one other browser session of the caller (path `me`). The current session signs out through Better Auth instead. A revoked session can pass until its cookie cache expires (ADR 0069).",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(revokeUserSessionResponseSchema, "Signed out"),
    400: jsonErrorResponse("Bad Request - Current session"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - Session not found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { sessionId } = c.req.valid("param");
    const caller = requireOwnSession(c.var.authContext, c.var.userRouteContext);
    if (sessionId === caller.sessionId) {
      throw badRequest("Sign out of this device with sign out");
    }

    const session = await prisma.session.findFirst({
      where: { id: sessionId, userId: caller.userId },
      select: { token: true },
    });
    if (!session) {
      throw notFound("Session not found");
    }

    // The internal adapter keeps Better Auth's own session bookkeeping in step.
    await (await auth.$context).internalAdapter.deleteSession(session.token);
    return ok(c, revokeUserSessionResponseSchema.parse({}));
  });
}
