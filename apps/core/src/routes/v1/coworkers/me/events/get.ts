import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/utils";

import { requireCoworkerCapability } from "@/helpers/access-control";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import { mapTaskEvent, taskEventApiInclude } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireCoworkerAuthContext } from "@/middleware/auth";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { taskEventSchema } from "@/schemas/task.schema";

const route = createRoute({
  method: "get",
  path: "/me/events",
  description: "List task events for the current coworker (paginated)",
  tags: ["Coworkers"],
  request: {
    query: cursorPaginationQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(taskEventSchema),
      "Retrieve current coworker task events",
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
    const authContext = requireCoworkerAuthContext(c.var.authContext);
    await requireCoworkerCapability(authContext.coworkerId, "tasks");
    const queryParams = c.req.valid("query");

    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const takePlusOne = take + 1;

    const where = {
      task: {
        coworkerId: authContext.coworkerId,
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
        include: taskEventApiInclude,
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

    return ok(
      c,
      z.array(taskEventSchema).parse(pagedEvents.map((e) => mapTaskEvent(e))),
      paginationMeta,
    );
  });
}
