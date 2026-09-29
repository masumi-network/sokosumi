import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import { forbidden, notFound } from "@/helpers/error";
import { notificationFeedWhere } from "@/helpers/notification-feed";
import { mapNotificationToItem } from "@/helpers/notification-item";
import { publishNotificationRow } from "@/helpers/notifications";
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
    path: "/{id}/unread",
    description:
      "Mark a single notification as unread for the interactive session user. The reader's way back from a read they did not mean. A chat mention put back here is unread everywhere, including the room's sidebar badge, which counts the same rows.",
    tags: ["Notifications"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        notificationItemSchema,
        "Notification marked as unread",
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
            isRead: false,
            readAt: null,
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

    // Scoped by the feed rule as well as the id. The control that calls this
    // sits in the notification center, which lists only feed rows, and a row
    // outside the feed put back to unread would count towards the room's
    // sidebar badge with nothing in the center able to clear it again.
    const notification = await prisma.notification.findFirst({
      where: { id, ...notificationFeedWhere() },
    });

    if (!notification) {
      throw notFound("Notification not found");
    }

    if (notification.userId !== userContext.userId) {
      throw forbidden("You can only mark your own notifications as unread");
    }

    const updated = notification.isRead
      ? await prisma.notification.update({
          where: { id },
          data: {
            isRead: false,
            readAt: null,
          },
        })
      : notification;

    // Published so the reader's other tabs and devices see the row go back,
    // the way the read direction publishes when a row is cleared. `osBanner`
    // false means no banner is raised: a row put back is not a new arrival,
    // and ringing for it would announce a message they have already seen.
    // `created` false for the same reason, so an open tab updates the row it
    // already holds rather than counting a second one.
    if (notification.isRead) {
      waitUntil(
        publishNotificationRow(
          updated,
          // No email either, and for the same reason as the banner: this
          // publishes a row the reader has just marked unread again, and
          // marking something unread is not a new thing to be told about.
          { inApp: updated.inApp, osBanner: false, email: false },
          false,
        ),
      );
    }

    return ok(c, notificationItemSchema.parse(mapNotificationToItem(updated)));
  });
}
