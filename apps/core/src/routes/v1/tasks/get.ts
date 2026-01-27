import { createRoute, z } from "@hono/zod-openapi";
import { Prisma, TaskStatus } from "@sokosumi/database";

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
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { taskSchema } from "@/schemas/task.schema";
import { taskInclude } from "@/types/task";

const query = z
  .object({
    status: z
      .enum(TaskStatus)
      .optional()
      .openapi({
        param: { name: "status", in: "query" },
        description: "Filter tasks by status",
        example: TaskStatus.READY,
      }),
    orchestratorId: z
      .string()
      .optional()
      .openapi({
        param: { name: "orchestratorId", in: "query" },
        description: "Filter tasks by orchestrator ID",
        example: "orc_123",
      }),
  })
  .extend(cursorPaginationQuerySchema.shape);

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: "List all tasks for the current user (paginated)",
    tags: ["Tasks"],
    request: {
      query,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(taskSchema),
        "Retrieve all tasks",
        {
          data: [
            {
              id: "tsk_123",
              userId: "user_123",
              name: "Review onboarding",
              status: TaskStatus.READY,
              orchestratorId: "orc_123",
              _count: {
                comments: 2,
              },
              updatedAt: "2025-01-02T12:00:00.000Z",
            },
          ],
          meta: {
            timestamp: "2025-01-02T12:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
            pagination: {
              cursor: null,
              limit: 20,
              total: 200,
              nextCursor: "tsk_124",
            },
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
    const { authContext } = c.var;
    const queryParams = c.req.valid("query");
    const { status, orchestratorId } = queryParams;
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    let where: Prisma.TaskWhereInput;
    if (authContext.orchestratorId) {
      if (status === TaskStatus.DRAFT) {
        throw badRequest(
          "Orchestrators cannot filter by DRAFT status. DRAFT tasks are not accessible to orchestrators.",
        );
      }
      where = {
        orchestratorId: authContext.orchestratorId,
        ...(status ? { status } : {}),
        NOT: { status: { in: [TaskStatus.DRAFT] } },
      };
    } else {
      where = {
        userId: authContext.userId,
        ...(status ? { status } : {}),
        ...(orchestratorId ? { orchestratorId } : {}),
      };
    }

    const takePlusOne = take + 1;
    const [tasks, count] = await prisma.$transaction([
      prisma.task.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: taskInclude,
      }),
      prisma.task.count({ where }),
    ]);

    const hasMore = tasks.length === takePlusOne;
    const mappedTasks = tasks.slice(0, take).map((task) => mapTask(task));
    const paginationMeta = createPaginationMeta(
      mappedTasks,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(c, z.array(taskSchema).parse(mappedTasks), paginationMeta);
  });
}
