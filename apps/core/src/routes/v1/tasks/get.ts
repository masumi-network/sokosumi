import { createRoute, z } from "@hono/zod-openapi";
import { Prisma, TaskStatus } from "@sokosumi/database";

import { requireCoworkerCapability } from "@/helpers/access-control";
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
import { mapTaskListItem } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { isCoworkerAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { taskListSchema } from "@/schemas/task.schema";
import { taskListInclude } from "@/types/task";

const taskStatusQuerySchema = z
  .preprocess(
    preprocessMultiValueQueryInput,
    z
      .array(z.enum(TaskStatus))
      .min(1)
      .optional()
      .transform(deduplicateQueryValues),
  )
  .openapi({
    param: { name: "status", in: "query" },
    description: "Comma-separated status filters",
    example: "READY,COMPLETED",
  });

const taskNameQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .openapi({
    param: { name: "q", in: "query" },
    description: "Case-insensitive task name filter",
    example: "review",
  });

const taskScopeQuerySchema = z
  .enum(["workspace", "owned"])
  .default("workspace")
  .openapi({
    param: { name: "scope", in: "query" },
    description:
      "workspace visibility scope. Defaults to 'workspace'. Use 'owned' to limit results to the authenticated user's tasks.",
    example: "owned",
  });

const query = z
  .object({
    q: taskNameQuerySchema,
    status: taskStatusQuerySchema,
    scope: taskScopeQuerySchema,
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
    description: "List tasks in the active workspace (paginated)",
    tags: ["Tasks"],
    request: {
      query,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(taskListSchema, "Retrieve all tasks"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const queryParams = c.req.valid("query");
    const { coworkerId, q, scope, status: statuses } = queryParams;
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const searchFilter = q
      ? {
          name: {
            contains: q,
            mode: "insensitive" as const,
          },
        }
      : {};

    let where: Prisma.TaskWhereInput;
    if (isCoworkerAuthContext(authContext)) {
      await requireCoworkerCapability(authContext.coworkerId, "tasks");

      if (statuses?.includes(TaskStatus.DRAFT)) {
        throw badRequest(
          "Coworkers cannot filter by DRAFT status. DRAFT tasks are not accessible to coworkers.",
        );
      }
      where = {
        coworkerId: authContext.coworkerId,
        archivedAt: null,
        ...(statuses ? { status: { in: statuses } } : {}),
        ...searchFilter,
        NOT: { status: { in: [TaskStatus.DRAFT] } },
      };
    } else {
      const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
      where = {
        archivedAt: null,
        workspaceId: workspaceContext.workspaceId,
        ...(scope === "owned" ? { userId: authContext.userId } : {}),
        ...(statuses ? { status: { in: statuses } } : {}),
        ...(coworkerId ? { coworkerId } : {}),
        ...searchFilter,
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
        include: taskListInclude,
      }),
      prisma.task.count({ where }),
    ]);

    const hasMore = tasks.length === takePlusOne;
    const mappedTasks = tasks
      .slice(0, take)
      .map((task) => mapTaskListItem(task));
    const paginationMeta = createPaginationMeta(
      mappedTasks,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(c, taskListSchema.parse(mappedTasks), paginationMeta);
  });
}
