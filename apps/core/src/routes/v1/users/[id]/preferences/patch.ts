import { createRoute, z } from "@hono/zod-openapi";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
} from "@sokosumi/utils";

import { internalServerError, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { nullableJsonInput } from "@/helpers/prisma-json";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  MAX_SEEN_SIDEBAR_ITEMS,
  sidebarIdSchema,
  sidebarLayoutOrNullSchema,
} from "@/schemas/sidebar-layout.schema";
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
    sidebarLayout: sidebarLayoutOrNullSchema.optional().openapi({
      description:
        "Replace the ordered sidebar layout. Send null to restore the defaults.",
    }),
    sidebarSeenItem: sidebarIdSchema.optional().openapi({
      description:
        "Mark one sidebar item seen for this user. Repeated visits have no effect.",
    }),
    marketingOptIn: z.boolean().optional().openapi({
      description: "Whether the user wants to receive marketing emails",
      example: true,
    }),
    pushOptIn: z.boolean().optional().openapi({
      description:
        "Whether the user wants OS banners while Sokosumi is closed (push)",
      example: false,
    }),
    showRoomUnreadCount: z.boolean().optional().openapi({
      description:
        "Whether chat sidebar rows show a room's unread message count. On unless the reader switched it off (ADR-0038). Display only: it changes no notification delivery",
      example: true,
    }),
    tagDirectMessages: z.boolean().optional().openapi({
      description:
        "Whether Jev may read this person's person-to-person Directs (chat signals). A Direct is read only when every human in it turned this on.",
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
        data.sidebarLayout !== undefined ||
        data.sidebarSeenItem !== undefined ||
        data.marketingOptIn !== undefined ||
        data.pushOptIn !== undefined ||
        data.showRoomUnreadCount !== undefined ||
        data.tagDirectMessages !== undefined ||
        (data.notificationPreferences !== undefined &&
          data.notificationPreferences.length > 0)
      );
    },
    {
      message: "At least one field must be provided",
      path: [
        "sidebarLayout",
        "sidebarSeenItem",
        "marketingOptIn",
        "pushOptIn",
        "showRoomUnreadCount",
        "tagDirectMessages",
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
            { category: "TASK_ATTENTION", channel: "IN_APP", enabled: true },
            { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
          ],
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
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const body = c.req.valid("json");

    const userFlags = {
      ...(body.sidebarLayout !== undefined && {
        sidebarLayout: nullableJsonInput(body.sidebarLayout),
      }),
      ...(body.marketingOptIn !== undefined && {
        marketingOptIn: body.marketingOptIn,
      }),
      ...(body.pushOptIn !== undefined && {
        pushOptIn: body.pushOptIn,
      }),
      // The wire says "show"; the column stores "hide" (ADR-0038), so a
      // reader who never chose is shown the count.
      ...(body.showRoomUnreadCount !== undefined && {
        hideRoomUnreadCount: !body.showRoomUnreadCount,
      }),
      ...(body.tagDirectMessages !== undefined && {
        tagDirectMessages: body.tagDirectMessages,
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

      if (body.sidebarSeenItem !== undefined) {
        // PostgreSQL rechecks both predicates under the user row lock when two visits race.
        await tx.$executeRaw`
          UPDATE "user"
          SET "sidebarSeenItems" = array_append("sidebarSeenItems", ${body.sidebarSeenItem}::text)
          WHERE "id" = ${resolvedUserId}
            AND NOT (${body.sidebarSeenItem}::text = ANY("sidebarSeenItems"))
            AND cardinality("sidebarSeenItems") < ${MAX_SEEN_SIDEBAR_ITEMS}
        `;
      }

      // A body that only changed the matrix has nothing to write on the user,
      // and an empty update would still bump `updatedAt`.
      const user =
        Object.keys(userFlags).length === 0
          ? await tx.user.findUnique({
              where: { id: resolvedUserId },
              select: USER_PREFERENCES_SELECT,
            })
          : await tx.user.update({
              where: { id: resolvedUserId },
              data: userFlags,
              select: USER_PREFERENCES_SELECT,
            });
      if (!user) {
        throw internalServerError("Failed to retrieve user");
      }
      if (
        body.sidebarSeenItem !== undefined &&
        !user.sidebarSeenItems.includes(body.sidebarSeenItem)
      ) {
        throw unprocessableEntity(
          "The account has reached the sidebar seen item limit",
        );
      }
      return user;
    });

    return ok(c, toUserPreferencesResponse(preferences));
  });
}
