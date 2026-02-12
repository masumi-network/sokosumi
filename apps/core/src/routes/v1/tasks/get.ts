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
    coworkerId: z
      .string()
      .optional()
      .openapi({
        param: { name: "coworkerId", in: "query" },
        description: "Filter tasks by coworker ID",
        example: "cow_123",
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
    const { status, coworkerId } = queryParams;
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    let where: Prisma.TaskWhereInput;
    if (authContext.coworkerId) {
      if (status === TaskStatus.DRAFT) {
        throw badRequest(
          "Coworkers cannot filter by DRAFT status. DRAFT tasks are not accessible to coworkers.",
        );
      }
      where = {
        coworkerId: authContext.coworkerId,
        ...(status ? { status } : {}),
        NOT: { status: { in: [TaskStatus.DRAFT] } },
      };
    } else {
      where = {
        userId: authContext.userId,
        organizationId: authContext.organizationId ?? null,
        ...(status ? { status } : {}),
        ...(coworkerId ? { coworkerId } : {}),
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
