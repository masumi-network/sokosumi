import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

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
import { requireOrchestratorAuthContext } from "@/middleware/auth";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { taskEventSchema } from "@/schemas/task.schema";

const route = createRoute({
  method: "get",
  path: "/me/events",
  operationId: "getMySokoBotTaskEvents",
  description: "List task events assigned to the authenticated Soko Bot",
  tags: ["Soko Bots"],
  request: { query: cursorPaginationQuerySchema },
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(taskEventSchema),
      "Retrieve the authenticated Soko Bot's task events",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export function mountSokoBotEventRoutes(app: OpenAPIHonoWithAuth): void {
  app.openapi(route, async (c) => {
    const auth = requireOrchestratorAuthContext(c.var.authContext);
    const query = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(query);
    const takePlusOne = take + 1;
    const where = {
      task: {
        assigneeOrchestratorId: auth.orchestratorId,
        workspaceId: auth.workspaceId,
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
    return ok(
      c,
      z.array(taskEventSchema).parse(pagedEvents.map(mapTaskEvent)),
      createPaginationMeta(pagedEvents, count, take, hasMore, cursor),
    );
  });
}
