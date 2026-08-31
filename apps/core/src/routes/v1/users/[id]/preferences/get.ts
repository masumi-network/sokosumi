import { createRoute, z } from "@hono/zod-openapi";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { userPreferencesResponseSchema } from "@/schemas/user.schema";

import { USER_PREFERENCES_SELECT } from "./preferences-select.js";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/preferences",
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
          pushOptIn: false,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const preferences = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: resolvedUserId },
        select: USER_PREFERENCES_SELECT,
      });

      if (!user) {
        throw internalServerError("Failed to retrieve user");
      }

      return user;
    });

    return ok(c, userPreferencesResponseSchema.parse(preferences));
  });
}
