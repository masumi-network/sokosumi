import { createRoute, z } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";
import { waitUntil } from "@vercel/functions";

import { notFound, unprocessableEntity } from "@/helpers/error";
import { cancelNotificationEmails } from "@/helpers/notification-email-dispatch";
import { notificationFeedWhere } from "@/helpers/notification-feed";
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

/** Furthest a row can be snoozed. The center offers next week at most. */
export const MAX_SNOOZE_MS = 31 * 24 * 60 * 60 * 1000;

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Notification ID",
    example: "cm123456789abcdefghij",
  }),
});

const bodySchema = z
  .strictObject({
    until: z.iso.datetime({ offset: true }).nullable().openapi({
      description:
        "When the row comes back, unread. Must lie ahead and within 31 days. Null unsnoozes it now.",
      example: "2026-06-17T09:00:00.000Z",
    }),
  })
  .openapi("SnoozeNotificationRequest");

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/{id}/snooze",
    description:
      "Snooze one of the interactive session user's notification-center rows, or unsnooze it. A snoozed row leaves the list, the counts, mark-all-read and the follow-up email until `until` passes, then is back as unread at its own place in the list. A scheduled email for it is cancelled. Chat rows cannot be snoozed: their room counts them.",
    tags: ["Notifications"],
    request: {
      params: paramsSchema,
      body: {
        content: { "application/json": { schema: bodySchema } },
        description: "When the row comes back, or null to unsnooze",
      },
    },
    responses: {
      200: jsonSuccessResponse(notificationItemSchema, "Notification snoozed", {
        data: {
          id: "cm123456789abcdefghij",
          userId: "cm123456789abcdefghij",
          kind: "TASK",
          referenceId: "cm123456789abcdefghij",
          eventId: "cm123456789abcdefghij",
          messageKey: "Notifications.Task.completed",
          messageParams: { coworkerName: "Ada", taskName: "Market Analysis" },
          metadata: null,
          isRead: false,
          readAt: null,
          createdAt: "2026-06-16T14:00:00.000Z",
          snoozedUntil: "2026-06-17T09:00:00.000Z",
        },
        meta: {
          timestamp: "2026-06-16T15:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { until } = c.req.valid("json");

    const snoozedUntil = until === null ? null : new Date(until);
    if (snoozedUntil) {
      const ahead = snoozedUntil.getTime() - Date.now();
      if (ahead <= 0 || ahead > MAX_SNOOZE_MS) {
        throw unprocessableEntity("Snooze must end within the next 31 days");
      }
    }

    // The reader's own feed rows only; someone else's row is "not found".
    const notification = await prisma.notification.findFirst({
      where: { id, userId: userContext.userId, ...notificationFeedWhere() },
    });

    if (!notification) {
      throw notFound("Notification not found");
    }

    if (notification.kind === NotificationKind.CHAT) {
      throw unprocessableEntity("Chat notifications cannot be snoozed");
    }

    // Snoozing makes the row unread, so it comes back as something to read.
    const updated = await prisma.notification.update({
      where: { id },
      data: snoozedUntil
        ? { snoozedUntil, isRead: false, readAt: null }
        : { snoozedUntil: null },
    });

    // The reader has seen it and said when: an email about it now is noise.
    if (snoozedUntil) {
      waitUntil(cancelNotificationEmails([notification]));
    }

    return ok(c, notificationItemSchema.parse(mapNotificationToItem(updated)));
  });
}
