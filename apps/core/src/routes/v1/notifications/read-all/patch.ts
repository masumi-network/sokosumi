import { createRoute, z } from "@hono/zod-openapi";

import { notificationFeedKindWhere } from "@/helpers/notification-feed";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";

const responseSchema = z
  .object({
    count: z.number().int().min(0).openapi({
      description: "Number of notifications marked as read",
      example: 10,
    }),
  })
  .openapi("MarkAllReadResponse");

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/read-all",
    description:
      "Mark all in-app notification-center items as read for the effective user (session user, or orchestrator/coworker with context headers). CHAT kind is excluded so room attention stays until the room is read.",
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
    const userContext = requireUserContext(c.var.authContext);

    const result = await prisma.notification.updateMany({
      where: {
        userId: userContext.userId,
        isRead: false,
        kind: notificationFeedKindWhere(),
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return ok(c, responseSchema.parse({ count: result.count }));
  });
}
