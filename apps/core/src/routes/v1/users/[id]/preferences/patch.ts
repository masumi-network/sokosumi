import { createRoute, z } from "@hono/zod-openapi";
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
  })
  .refine(
    (data) => {
      return (
        data.marketingOptIn !== undefined ||
        data.notificationsOptIn !== undefined
      );
    },
    {
      message: "At least one field must be provided",
      path: ["marketingOptIn", "notificationsOptIn"],
    },
  );

const route = createRoute({
  method: "patch",
  path: "/{id}/preferences",
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
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id: pathUser } = c.req.valid("param");
    const { targetUserId } = resolveUsersPathUserId(
      c.var.authContext,
      pathUser,
    );
    const body = c.req.valid("json");

    const preferences = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: targetUserId },
        data: {
          ...(body.marketingOptIn !== undefined && {
            marketingOptIn: body.marketingOptIn,
          }),
          ...(body.notificationsOptIn !== undefined && {
            notificationsOptIn: body.notificationsOptIn,
          }),
        },
        select: {
          marketingOptIn: true,
          notificationsOptIn: true,
        },
      });

      return updatedUser;
    });

    return ok(c, userPreferencesResponseSchema.parse(preferences));
  });
}
