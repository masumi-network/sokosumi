import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
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
    method: "delete",
    path: "/{id}",
    description:
      "Delete a single notification for the interactive session user. The row is looked up by id and reader together, so another reader's notification reads as missing rather than as forbidden. Deleting is not marking read: nothing else the notification points at is changed. The row is gone for good; there is no undo and no way to restore it.",
    tags: ["Notifications"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(notificationItemSchema, "Notification deleted", {
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
      }),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const where = { id, userId: userContext.userId };

    // Read before deleting, because the response carries the row that went and
    // the app reads its unread state from there.
    const notification = await prisma.notification.findFirst({ where });

    if (!notification) {
      throw notFound("Notification not found");
    }

    // deleteMany rather than delete: a row that goes between the two queries
    // is the result this route asked for, not an error to report.
    await prisma.notification.deleteMany({ where });

    return ok(
      c,
      notificationItemSchema.parse(mapNotificationToItem(notification)),
    );
  });
}
