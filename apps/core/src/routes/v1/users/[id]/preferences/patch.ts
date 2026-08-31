import { createRoute, z } from "@hono/zod-openapi";
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

const requestBodySchema = z
  .object({
    marketingOptIn: z.boolean().optional().openapi({
      description: "Whether the user wants to receive marketing emails",
      example: true,
    }),
    notificationsOptIn: z.boolean().optional().openapi({
      description: "Whether the user wants to receive job status notifications",
      example: true,
    }),
    pushOptIn: z.boolean().optional().openapi({
      description:
        "Whether the user wants OS banners while Sokosumi is closed (push)",
      example: false,
    }),
  })
  .refine(
    (data) => {
      return (
        data.marketingOptIn !== undefined ||
        data.notificationsOptIn !== undefined ||
        data.pushOptIn !== undefined
      );
    },
    {
      message: "At least one field must be provided",
      path: ["marketingOptIn", "notificationsOptIn", "pushOptIn"],
    },
  );

const route = createRoute({
  method: "patch",
  path: "/preferences",
  description:
    "Update preferences: path `me` for the session user, or a user id when the caller may access that user's data.",
  tags: ["Users"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: requestBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      userPreferencesResponseSchema,
      "Update the user's preferences",
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
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const body = c.req.valid("json");

    const preferences = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: resolvedUserId },
        data: {
          ...(body.marketingOptIn !== undefined && {
            marketingOptIn: body.marketingOptIn,
          }),
          ...(body.notificationsOptIn !== undefined && {
            notificationsOptIn: body.notificationsOptIn,
          }),
          ...(body.pushOptIn !== undefined && {
            pushOptIn: body.pushOptIn,
          }),
        },
        select: USER_PREFERENCES_SELECT,
      });

      return updatedUser;
    });

    return ok(c, userPreferencesResponseSchema.parse(preferences));
  });
}
