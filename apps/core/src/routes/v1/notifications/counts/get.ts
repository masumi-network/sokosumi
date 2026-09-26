import { createRoute } from "@hono/zod-openapi";
import { MENTION_MESSAGE_KEYS } from "@sokosumi/utils";

import {
  findNeedsActionNotificationIds,
  resolvedNotificationFeedWhere,
} from "@/helpers/notification-feed";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { notificationCountsSchema } from "@/schemas/notification.schema";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/counts",
    description:
      "Counts over the interactive session user's in-app notification-center feed: rows still unread, rows whose request still waits on the reader (the Needs you view), and unread mentions (the Mentions view). CHAT kind is excluded except for room messages.",
    tags: ["Notifications"],
    responses: {
      200: jsonSuccessResponse(notificationCountsSchema, "Counts retrieved", {
        data: { unread: 5, needsAction: 2, mentions: 1 },
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

    const [feedWhere, needsActionIds] = await Promise.all([
      resolvedNotificationFeedWhere(userContext.userId),
      findNeedsActionNotificationIds(userContext.userId),
    ]);

    // The same feed clause the list applies, so the needs-action number is
    // the number of rows the Needs you view shows and nothing else, and the
    // mentions number is the unread rows under the Mentions view.
    const [unread, needsAction, mentions] = await Promise.all([
      prisma.notification.count({ where: { ...feedWhere, isRead: false } }),
      prisma.notification.count({
        where: { ...feedWhere, id: { in: needsActionIds } },
      }),
      prisma.notification.count({
        where: {
          ...feedWhere,
          isRead: false,
          messageKey: { in: [...MENTION_MESSAGE_KEYS] },
        },
      }),
    ]);

    return ok(
      c,
      notificationCountsSchema.parse({ unread, needsAction, mentions }),
    );
  });
}
