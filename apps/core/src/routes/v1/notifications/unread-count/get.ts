import { createRoute } from "@hono/zod-openapi";

import {
  excludeResolvedCoworkerAccessNotificationsWhere,
  excludeResolvedVendorGrantNotificationsWhere,
  findStaleCoworkerAccessNotificationReferenceIds,
  findStaleVendorGrantNotificationReferenceIds,
  mergeAccessNotificationExclusions,
  notificationFeedKindWhere,
} from "@/helpers/notification-feed";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrchestratorContextHeaderParameters,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { unreadCountSchema } from "@/schemas/notification.schema";

const route = withOrchestratorContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/unread-count",
    description:
      "Get the count of unread in-app notification-center items for the effective user (session user, or orchestrator with context headers). CHAT kind is excluded.",
    tags: ["Notifications"],
    responses: {
      200: jsonSuccessResponse(unreadCountSchema, "Unread count retrieved", {
        data: { count: 5 },
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

    const [staleVendorGrantReferenceIds, staleCoworkerAccessReferenceIds] =
      await Promise.all([
        findStaleVendorGrantNotificationReferenceIds(userContext.userId),
        findStaleCoworkerAccessNotificationReferenceIds(userContext.userId),
      ]);

    const count = await prisma.notification.count({
      where: {
        userId: userContext.userId,
        isRead: false,
        kind: notificationFeedKindWhere(),
        ...mergeAccessNotificationExclusions(
          excludeResolvedVendorGrantNotificationsWhere(
            staleVendorGrantReferenceIds,
          ),
          excludeResolvedCoworkerAccessNotificationsWhere(
            staleCoworkerAccessReferenceIds,
          ),
        ),
      },
    });

    return ok(c, unreadCountSchema.parse({ count }));
  });
}
