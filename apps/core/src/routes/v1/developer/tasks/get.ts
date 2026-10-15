import { createRoute } from "@hono/zod-openapi";

import {
  buildDeveloperOwnedCoworkerTaskWhere,
  requireOwnedCoworkerForFilter,
} from "@/helpers/developer-owned-coworker-tasks";
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
import { requireUserAuthContext } from "@/middleware/auth";
import {
  developerTaskListQuerySchema,
  developerTaskListSchema,
} from "@/schemas/developer.schema";

const developerTaskListInclude = {
  assignee: { select: { id: true, name: true, slug: true } },
  creatorCoworker: { select: { id: true, name: true, slug: true } },
  owner: { select: { id: true, name: true, email: true } },
  organization: { select: { id: true, name: true, slug: true } },
} as const;

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listDeveloperOwnedCoworkerTasks",
  description:
    "Paginated list of tasks where an owned coworker is assignee or creator, across end-user workspaces.",
  tags: ["Developer"],
  request: {
    query: developerTaskListQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      developerTaskListSchema,
      "Paginated list of tasks for owned coworkers",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userAuth = requireUserAuthContext(c.var.authContext);
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    if (queryParams.coworkerId) {
      await requireOwnedCoworkerForFilter(
        userAuth.userId,
        queryParams.coworkerId,
      );
    }

    const where = buildDeveloperOwnedCoworkerTaskWhere(
      userAuth.userId,
      queryParams.coworkerId,
    );

    const takePlusOne = take + 1;
    const [tasks, total] = await prisma.$transaction([
      prisma.task.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: developerTaskListInclude,
      }),
      prisma.task.count({ where }),
    ]);

    const hasMore = tasks.length === takePlusOne;
    const items = tasks.slice(0, take).map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      assignee: task.assignee,
      creatorCoworker: task.creatorCoworker,
      owner: task.owner,
      organization: task.organization,
    }));

    const paginationMeta = createPaginationMeta(
      items,
      total,
      take,
      hasMore,
      cursor,
    );

    return ok(c, developerTaskListSchema.parse(items), paginationMeta);
  });
}
