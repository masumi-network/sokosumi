import { createRoute } from "@hono/zod-openapi";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { userPreferencesResponseSchema } from "@/schemas/user.schema";

const route = createRoute({
  method: "get",
  path: "/me/preferences",
  description: "Get current user's preferences",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(
      userPreferencesResponseSchema,
      "Retrieve the current user's preferences",
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
    const authContext = requireUserAuthContext(c.var.authContext);

    const preferences = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: authContext.userId },
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
