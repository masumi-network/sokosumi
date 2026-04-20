import { createRoute, z } from "@hono/zod-openapi";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  resolveUsersPathUserId,
  usersRoutePathUserIdSchema,
} from "@/routes/v1/users/user-path-access";
import { userPreferencesResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/{id}/preferences",
  description:
    "Get preferences: path `me` for the session user, or a user id when the caller may access that user's data.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      userPreferencesResponseSchema,
      "Retrieve the user's preferences",
      {
        data: {
          marketingOptIn: true,
          notificationsOptIn: true,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id: pathUser } = c.req.valid("param");
    const { targetUserId } = resolveUsersPathUserId(
      c.var.authContext,
      pathUser,
    );

    const preferences = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: targetUserId },
        select: {
          marketingOptIn: true,
          notificationsOptIn: true,
        },
      });

      if (!user) {
        throw internalServerError("Failed to retrieve user");
      }

      return user;
    });

    return ok(c, userPreferencesResponseSchema.parse(preferences));
  });
}
