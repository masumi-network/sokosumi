import { createRoute, z } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";
import { CHAT_ROOM_MESSAGE_MESSAGE_KEY } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";

import { forbidden, notFound } from "@/helpers/error";
import { cancelNotificationEmails } from "@/helpers/notification-email-dispatch";
import { mapNotificationToItem } from "@/helpers/notification-item";
import { publishClearedNotifications } from "@/helpers/notifications";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { notificationItemSchema } from "@/schemas/notification.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Notification ID",
    example: "cm123456789abcdefghij",
  }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/{id}/read",
    description:
      "Mark a single notification as read for the interactive session user. Includes CHAT: browser OS clicks and room attention still clear individual CHAT rows even though CHAT is excluded from the in-app center list, unread badge, and mark-all-read.",
    tags: ["Notifications"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        notificationItemSchema,
        "Notification marked as read",
        {
          data: {
            id: "cm123456789abcdefghij",
            userId: "cm123456789abcdefghij",
            kind: "TASK",
            referenceId: "cm123456789abcdefghij",
            eventId: "cm123456789abcdefghij",
            messageKey: "Notifications.Task.completed",
            messageParams: {
              coworkerName: "Ada",
              taskName: "Market Analysis",
            },
            metadata: { agentId: "agent_123", projectId: "proj_456" },
            isRead: true,
            readAt: "2026-06-16T15:00:00.000Z",
            createdAt: "2026-06-16T14:00:00.000Z",
          },
          meta: {
            timestamp: "2026-06-16T15:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
          },
        },
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      throw notFound("Notification not found");
    }

    if (notification.userId !== userContext.userId) {
      throw forbidden("You can only mark your own notifications as read");
    }

    // The read is claimed with a conditional write, so of two requests
    // arriving together only one moves the row. The row is read again
    // afterwards because an email handed over in between is on the written
    // row only, and because a request resolved in between deletes its rows:
    // that leaves the first read standing rather than failing the read the
    // caller asked for.
    let updated = notification;
    let claimedTheRead = false;

    if (!notification.isRead) {
      const { count } = await prisma.notification.updateMany({
        where: { id, isRead: false },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      claimedTheRead = count === 1;
      updated =
        (await prisma.notification.findUnique({ where: { id } })) ?? updated;
    }

    // Scheduled rather than awaited, so a failed cancel costs the reader one
    // email they have already read instead of the read they asked for. Only
    // the request that claimed the read cancels: the other would ask Resend
    // to drop an email that is already gone, and report the refusal.
    if (claimedTheRead) {
      waitUntil(cancelNotificationEmails([updated]));
    }

    // The counted room row is the one a banner stands for, so it is the only
    // row whose reading takes a banner down. A mention shares the room's
    // banner without standing for it, and a job row has a banner of its own
    // that keeps behaving as it did.
    //
    // Published even when the row was already read: the reader is saying they
    // are done with the room, and a banner can outlive its row on a second
    // device or through a publish that never arrived.
    //
    // Scheduled rather than awaited, so a failed publish costs the reader a
    // stale banner instead of the read they asked for.
    if (
      notification.kind === NotificationKind.CHAT &&
      notification.messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY
    ) {
      waitUntil(publishClearedNotifications([updated.id]));
    }

    return ok(c, notificationItemSchema.parse(mapNotificationToItem(updated)));
  });
}
