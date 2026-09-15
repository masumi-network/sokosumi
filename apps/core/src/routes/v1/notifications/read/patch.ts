import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import { markNotificationsRead } from "@/helpers/notification-read";
import { publishClearedNotifications } from "@/helpers/notifications";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";

/**
 * Upper bound on one request. The notification center holds ten rows, so a
 * caller asking for more than this has lost track of what it is reading, and
 * the reader has `read-all` for the rest.
 */
const MAX_NOTIFICATION_IDS = 25;

const requestSchema = z
  .object({
    ids: z
      .array(z.string())
      .min(1)
      .max(MAX_NOTIFICATION_IDS)
      .openapi({
        description: "Notification IDs to mark as read",
        example: ["cm123456789abcdefghij"],
      }),
  })
  .openapi("MarkNotificationsReadRequest");

const responseSchema = z
  .object({
    count: z.number().int().min(0).openapi({
      description: "Number of notifications this request marked as read",
      example: 3,
    }),
  })
  .openapi("MarkNotificationsReadResponse");

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/read",
    description:
      "Mark the named in-app notification-center items as read for the interactive session user. Scoped by the feed rule and by the reader's own rows, so an id the feed would never show, and an id belonging to someone else, are both ignored rather than refused. A mention read here is read everywhere, including the room's sidebar badge, which counts the same rows.",
    tags: ["Notifications"],
    request: {
      body: {
        content: { "application/json": { schema: requestSchema } },
        description: "Notification IDs to mark as read",
      },
    },
    responses: {
      200: jsonSuccessResponse(responseSchema, "Notifications marked as read", {
        data: { count: 3 },
        meta: {
          timestamp: "2026-06-16T15:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      401: jsonErrorResponse("Unauthorized"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { ids } = c.req.valid("json");

    const { count, clearedRoomIds } = await markNotificationsRead(
      userContext.userId,
      { id: { in: ids } },
    );

    // Scheduled rather than awaited, for the same reason the single-row route
    // schedules it: a failed publish must not cost the reader the read.
    waitUntil(publishClearedNotifications(clearedRoomIds));

    return ok(c, responseSchema.parse({ count }));
  });
}
