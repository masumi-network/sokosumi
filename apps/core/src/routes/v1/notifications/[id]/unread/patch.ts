import { createRoute, z } from "@hono/zod-openapi";

import { forbidden, notFound } from "@/helpers/error";
import { mapNotificationToItem } from "@/helpers/notification-item";
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
      "Mark a single notification as unread for the interactive session user. The reader's way back from a read they did not mean, including one the notification center wrote for them when they closed it. A chat mention put back here is unread everywhere, including the room's sidebar badge, which counts the same rows.",
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
            kind: "JOB",
            referenceId: "cm123456789abcdefghij",
            eventId: "cm123456789abcdefghij",
            messageKey: "Notifications.Job.completed",
            messageParams: {
              agentName: "Research Agent",
              jobName: "Market Analysis",
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

    const notification = await prisma.notification.findUnique({
      where: { id },
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

    // No clear event: a banner stands for a waiting room row, and nothing is
    // waiting again just because the reader put the row back. Publishing an
    // arrival here would ring for a message they have already seen.

    return ok(c, notificationItemSchema.parse(mapNotificationToItem(updated)));
  });
}
