import { createRoute, z } from "@hono/zod-openapi";

import { notificationFeedWhere } from "@/helpers/notification-feed";
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
      description: "Number of notifications deleted",
      example: 10,
    }),
  })
  .openapi("ClearNotificationsResponse");

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/",
    description:
      "Delete every in-app notification-center item for the interactive session user. Scoped by the same feed rule as mark-all-read, so it reaches a mention and a room message but leaves a direct message alone. A deleted mention also stops counting toward the room's sidebar badge, which counts the same rows. There is no undo.",
    tags: ["Notifications"],
    responses: {
      200: jsonSuccessResponse(responseSchema, "Notification center cleared", {
        data: { count: 10 },
        meta: {
          timestamp: "2026-06-16T15:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      401: jsonErrorResponse("Unauthorized"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);

    const result = await prisma.notification.deleteMany({
      where: {
        userId: userContext.userId,
        ...notificationFeedWhere(),
      },
    });

    return ok(c, responseSchema.parse({ count: result.count }));
  });
}
