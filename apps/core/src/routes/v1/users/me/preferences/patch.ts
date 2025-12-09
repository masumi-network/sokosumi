import { createRoute, z } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { userPreferencesResponseSchema } from "@/schemas/user.schema";

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
  path: "/me/preferences",
  tags: ["Users"],
  request: {
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
      "Update the current user's preferences",
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
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const body = c.req.valid("json");

    const preferences = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: authContext.userId },
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
