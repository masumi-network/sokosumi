import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { forbidden } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { taskEventSchema } from "@/schemas/task.schema";

import { paramsSchema } from "../schema";

const route = createRoute({
  method: "get",
  path: "/{id}/events",
  description: "List task events for a coworker (paginated, deprecated)",
  tags: ["Coworkers"],
  deprecated: true,
  request: {
    params: paramsSchema,
    query: cursorPaginationQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(taskEventSchema),
      "Retrieve coworker task events",
      {
        data: [
          {
            id: "evt_123",
            taskId: "tsk_123",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
            userId: "user_123",
            coworkerId: "cow_123",
            comment: "Looks good.",
            authenticationUrl: null,
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
            total: 200,
            nextCursor: "evt_124",
          },
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const queryParams = c.req.valid("query");

    if (!authContext.coworkerId || authContext.coworkerId !== id) {
      throw forbidden("Coworker can only access its own events");
    }

    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const takePlusOne = take + 1;

    const where = {
      task: {
        coworkerId: id,
        status: { not: TaskStatus.DRAFT },
      },
    };

    const [events, count] = await prisma.$transaction([
      prisma.taskEvent.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      prisma.taskEvent.count({ where }),
    ]);

    const hasMore = events.length === takePlusOne;
    const pagedEvents = events.slice(0, take);
    const paginationMeta = createPaginationMeta(
      pagedEvents,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(c, z.array(taskEventSchema).parse(pagedEvents), paginationMeta);
  });
}
