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
      "Mark all in-app notification-center items as read for the interactive session user. Scoped by the feed rule, so it reaches a mention and a room message but never a direct message. A mention read here is read everywhere, including the room's sidebar badge, which counts the same rows.",
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

    const { count, clearedRoomIds } = await markNotificationsRead(
      userContext.userId,
    );

    // Scheduled rather than awaited, for the same reason the single-row route
    // schedules it: a failed publish must not cost the reader the read.
    waitUntil(publishClearedNotifications(clearedRoomIds));

    return ok(c, responseSchema.parse({ count }));
  });
}
