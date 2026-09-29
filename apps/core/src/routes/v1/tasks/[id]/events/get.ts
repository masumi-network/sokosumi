import { createRoute, z } from "@hono/zod-openapi";

import { LIMITS } from "@/config/constants";
import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { badRequest } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import { mapTaskEvent } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type CursorPaginationMeta,
  cursorPaginationMetaSchema,
} from "@/schemas/pagination.schema";
import { taskEventSchema } from "@/schemas/task.schema";
import { taskEventApiInclude } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

/**
 * Pagination is opt-in. Omitting both `limit` and `cursor` keeps the pre-pagination
 * contract (full event list). An empty `cursor` is rejected at the query boundary.
 */
const taskEventsQuerySchema = z
  .object({
    cursor: z
      .string()
      .min(1)
      .optional()
      .openapi({
        param: { name: "cursor", in: "query" },
        description:
          "Cursor for pagination (ID of the last item from previous page)",
        example: "evt_124",
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.MAX_PAGINATION_LIMIT)
      .optional()
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Number of items to return (max ${LIMITS.MAX_PAGINATION_LIMIT}). Omit with no cursor to return the full event list.`,
        example: LIMITS.DEFAULT_PAGINATION_LIMIT,
      }),
  })
  .openapi("TaskEventsPaginationQuery");

const taskEventsPaginationMetaSchema = cursorPaginationMetaSchema
  .extend({
    commentCount: z.number().int().min(0).openapi({
      example: 3,
      description: "Count of events on this task with a non-null comment",
    }),
    latestCommentId: z.string().nullable().openapi({
      example: "evt_124",
      description:
        "Id of the newest comment event (createdAt desc, then id desc), or null",
    }),
  })
  .openapi("TaskEventsPaginationMetadata");

type TaskEventsPaginationMeta = z.infer<typeof taskEventsPaginationMetaSchema>;

const route = createRoute({
  method: "get",
  path: "/{id}/events",
  description:
    "List task events (oldest first). Paginate with limit/cursor; omit both for the full list.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    query: taskEventsQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(taskEventSchema),
      "Retrieve task events",
      {
        data: [
          {
            id: "evt_123",
            taskId: "tsk_123",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
            userId: "user_123",
            coworkerId: null,
            comment: "Looks good.",
            authenticationUrl: null,
            channel: "SOKOSUMI",
            origin: "SOKOSUMI",
            status: "RUNNING",
          },
        ],
        meta: {
          timestamp: "2025-01-02T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
          pagination: {
            cursor: null,
            limit: 20,
            total: 100,
            nextCursor: "evt_124",
            commentCount: 12,
            latestCommentId: "evt_200",
          },
        },
      },
      taskEventsPaginationMetaSchema,
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const queryParams = c.req.valid("query");

    await requireTaskReadForRouteVars(c.var, id, prisma);

    const where = { taskId: id };
    const commentWhere = { taskId: id, comment: { not: null } };
    const paginate =
      queryParams.cursor !== undefined || queryParams.limit !== undefined;
    const { cursor, take, skip } = paginate
      ? parseCursorPagination(queryParams)
      : { cursor: undefined, take: 0, skip: undefined };

    if (cursor) {
      const cursorEvent = await prisma.taskEvent.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { id: true },
      });
      if (!cursorEvent) {
        throw badRequest("Invalid pagination cursor");
      }
    }

    const takePlusOne = paginate ? take + 1 : undefined;

    const [events, count, commentCount, latestComment] =
      await prisma.$transaction([
        prisma.taskEvent.findMany({
          where,
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: taskEventApiInclude,
        }),
        prisma.taskEvent.count({ where }),
        prisma.taskEvent.count({ where: commentWhere }),
        prisma.taskEvent.findFirst({
          where: commentWhere,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        }),
      ]);

    const hasMore = paginate && events.length === takePlusOne;
    const pagedEvents = paginate ? events.slice(0, take) : events;
    const pageLimit = paginate ? take : pagedEvents.length;
    const paginationMeta: TaskEventsPaginationMeta = {
      ...createPaginationMeta(pagedEvents, count, pageLimit, hasMore, cursor),
      commentCount,
      latestCommentId: latestComment?.id ?? null,
    };

    return ok(
      c,
      z.array(taskEventSchema).parse(pagedEvents.map((e) => mapTaskEvent(e))),
      paginationMeta as CursorPaginationMeta,
    );
  });
}
