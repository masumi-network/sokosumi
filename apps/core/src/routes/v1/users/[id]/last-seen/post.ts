import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { userLastSeenResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "post",
  path: "/last-seen",
  description:
    "Record that the human owner just opened the app. The timestamp is server-generated — the previous value is what /chat reports against, so a client must not be able to choose it. Session/owner actors only (not coworker tokens).",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(userLastSeenResponseSchema, "Visit recorded", {
      data: { lastSeenAt: "2026-08-11T12:00:00.000Z" },
      meta: {
        timestamp: "2026-08-11T12:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    // Same owner lock as GET /tasks/summary: a coworker token with user context
    // must not rewrite the human's "opened the app" marker.
    requireOwnerUserContext(c.var.authContext);
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const updatedUser = await prisma.user.update({
      where: { id: resolvedUserId },
      data: { lastSeenAt: new Date() },
      select: { lastSeenAt: true },
    });

    return ok(
      c,
      userLastSeenResponseSchema.parse({
        lastSeenAt: updatedUser.lastSeenAt ?? new Date(),
      }),
    );
  });
}
