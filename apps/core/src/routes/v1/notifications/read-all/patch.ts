import { createRoute, z } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";
import { CHAT_ROOM_MESSAGE_MESSAGE_KEY } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";

import { notificationFeedWhere } from "@/helpers/notification-feed";
import { publishClearedNotifications } from "@/helpers/notifications";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";

const responseSchema = z
  .object({
    count: z.number().int().min(0).openapi({
      description: "Number of notifications marked as read",
      example: 10,
    }),
  })
  .openapi("MarkAllReadResponse");

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/read-all",
    description:
      "Mark all in-app notification-center items as read for the interactive session user. CHAT kind is excluded except for room messages, so a mention stays until its room is read.",
    tags: ["Notifications"],
    responses: {
      200: jsonSuccessResponse(
        responseSchema,
        "All notifications marked as read",
        {
          data: { count: 10 },
          meta: {
            timestamp: "2026-06-16T15:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
          },
        },
      ),
      401: jsonErrorResponse("Unauthorized"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);

    // Return the changed rows so arrivals during this request also get a
    // clear event if this write marks them read.
    const clearedRows = await prisma.notification.updateManyAndReturn({
      where: {
        userId: userContext.userId,
        isRead: false,
        ...notificationFeedWhere(),
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
      select: { id: true, kind: true, messageKey: true },
    });

    const clearedRoomIds = clearedRows
      .filter(
        (row) =>
          row.kind === NotificationKind.CHAT &&
          row.messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY,
      )
      .map((row) => row.id);

    // Scheduled rather than awaited, for the same reason the single-row route
    // schedules it: a failed publish must not cost the reader the read.
    waitUntil(publishClearedNotifications(clearedRoomIds));

    return ok(c, responseSchema.parse({ count: clearedRows.length }));
  });
}
