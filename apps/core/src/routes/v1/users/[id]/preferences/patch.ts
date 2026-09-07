import { createRoute, z } from "@hono/zod-openapi";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
} from "@sokosumi/utils";

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
import {
  notificationPreferenceSchema,
  userPreferencesResponseSchema,
} from "@/schemas/user.schema";

import {
  toUserPreferencesResponse,
  USER_PREFERENCES_SELECT,
} from "./preferences-select.js";

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
    notificationPreferences: z
      .array(notificationPreferenceSchema)
      // One write per cell, inside one transaction, so the body cannot ask for
      // more writes than the matrix has cells.
      .max(NOTIFICATION_CATEGORIES.length * NOTIFICATION_CHANNELS.length)
      .optional()
      .openapi({
        description:
          "The matrix cells the reader changed. A cell left out keeps its current answer.",
      }),
  })
  .refine(
    (data) => {
      return (
        data.marketingOptIn !== undefined ||
        data.notificationsOptIn !== undefined ||
        data.pushOptIn !== undefined ||
        (data.notificationPreferences !== undefined &&
          data.notificationPreferences.length > 0)
      );
    },
    {
      message: "At least one field must be provided",
      path: [
        "marketingOptIn",
        "notificationsOptIn",
        "pushOptIn",
        "notificationPreferences",
      ],
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
          notificationPreferences: [
            { category: "JOB_ATTENTION", channel: "IN_APP", enabled: true },
            { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
          ],
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

    const userFlags = {
      ...(body.marketingOptIn !== undefined && {
        marketingOptIn: body.marketingOptIn,
      }),
      ...(body.notificationsOptIn !== undefined && {
        notificationsOptIn: body.notificationsOptIn,
      }),
      ...(body.pushOptIn !== undefined && {
        pushOptIn: body.pushOptIn,
      }),
    };

    const preferences = await prisma.$transaction(async (tx) => {
      for (const cell of body.notificationPreferences ?? []) {
        await tx.notificationPreference.upsert({
          where: {
            userId_category_channel: {
              userId: resolvedUserId,
              category: cell.category,
              channel: cell.channel,
            },
          },
          create: {
            userId: resolvedUserId,
            category: cell.category,
            channel: cell.channel,
            enabled: cell.enabled,
          },
          update: { enabled: cell.enabled },
        });
      }

      // A body that only changed the matrix has nothing to write on the user,
      // and an empty update would still bump `updatedAt`.
      if (Object.keys(userFlags).length === 0) {
        const user = await tx.user.findUnique({
          where: { id: resolvedUserId },
          select: USER_PREFERENCES_SELECT,
        });

        if (!user) {
          throw internalServerError("Failed to retrieve user");
        }

        return user;
      }

      return await tx.user.update({
        where: { id: resolvedUserId },
        data: userFlags,
        select: USER_PREFERENCES_SELECT,
      });
    });

    return ok(c, toUserPreferencesResponse(preferences));
  });
}
