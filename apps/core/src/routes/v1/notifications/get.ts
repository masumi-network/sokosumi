import { createRoute, z } from "@hono/zod-openapi";
import { type NotificationKind, type Prisma } from "@sokosumi/database";

import { badRequest } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "@/helpers/query-params";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  notificationKindSchema,
  notificationListSchema,
} from "@/schemas/notification.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

const notificationKindsQuerySchema = z
  .preprocess(
    preprocessMultiValueQueryInput,
    z
      .array(notificationKindSchema)
      .min(1)
      .optional()
      .transform(deduplicateQueryValues),
  )
  .openapi({
    param: { name: "kind", in: "query" },
    description:
      "Comma-separated notification kinds to filter (e.g. JOB,TASK,CONVERSATION)",
    example: "JOB,TASK",
  });

const isReadQuerySchema = z
  .enum(["true", "false"])
  .optional()
  .transform((val) => (val === undefined ? undefined : val === "true"))
  .openapi({
    param: { name: "isRead", in: "query" },
    description: "Filter by read status (true or false)",
    example: "false",
  });

const query = z
  .object({
    kind: notificationKindsQuerySchema,
    isRead: isReadQuerySchema,
  })
  .extend(cursorPaginationQuerySchema.shape);

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List notifications for the authenticated user with cursor pagination",
    tags: ["Notifications"],
    request: {
      query,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        notificationListSchema,
        "Retrieve notification feed items",
        {
          data: [
            {
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
              createdAt: "2026-06-16T15:00:00.000Z",
            },
          ],
          meta: {
            timestamp: "2026-06-16T15:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
            pagination: {
              cursor: null,
              limit: 20,
              total: 100,
              nextCursor: "cm123456789abcdefghij",
            },
          },
        },
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

function mapNotificationToItem(notification: {
  id: string;
  userId: string;
  kind: NotificationKind;
  referenceId: string;
  eventId: string;
  messageKey: string;
  messageParams: string;
  metadata: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: notification.id,
    userId: notification.userId,
    kind: notification.kind,
    referenceId: notification.referenceId,
    eventId: notification.eventId,
    messageKey: notification.messageKey,
    messageParams: JSON.parse(notification.messageParams) as Record<
      string,
      unknown
    >,
    metadata: notification.metadata
      ? (JSON.parse(notification.metadata) as Record<string, unknown>)
      : null,
    isRead: notification.isRead,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    const where: Prisma.NotificationWhereInput = {
      userId: userContext.userId,
    };

    if (queryParams.kind) {
      where.kind = { in: queryParams.kind };
    }

    if (queryParams.isRead !== undefined) {
      where.isRead = queryParams.isRead;
    }

    const takePlusOne = take + 1;

    // For cursor pagination, we need to find the notification by id
    const cursorNotification = cursor
      ? await prisma.notification.findUnique({
          where: { id: cursor },
          select: { id: true },
        })
      : undefined;

    if (cursor && !cursorNotification) {
      throw badRequest("Invalid pagination cursor");
    }

    const [rows, count] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        take: takePlusOne,
        skip: cursorNotification ? 1 : skip,
        cursor: cursorNotification ? { id: cursorNotification.id } : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      prisma.notification.count({ where }),
    ]);

    const hasMore = rows.length === takePlusOne;
    const pagedRows = rows.slice(0, take);
    const notificationItems = pagedRows.map(mapNotificationToItem);
    const paginationMeta = createPaginationMeta(
      notificationItems,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(
      c,
      notificationListSchema.parse(notificationItems),
      paginationMeta,
    );
  });
}
