import { createRoute, z } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

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
import {
  buildDelegatedWorkspaceAwaitingVendorApprovalTaskFilter,
  buildSessionWorkspaceAwaitingVendorApprovalTaskFilter,
} from "@/helpers/vendor-grants";
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
  .default("owned")
  .openapi({
    param: { name: "scope", in: "query" },
    description:
      "workspace visibility scope. Defaults to 'owned'. Use 'workspace' to include all tasks in the active workspace.",
    example: "workspace",
  });

const projectIdQuerySchema = z
  .union([z.string().uuid(), z.literal("null")])
  .optional()
  .openapi({
    param: { name: "projectId", in: "query" },
    description:
      "Filter tasks by project ID. Use the literal value 'null' to return tasks that are not assigned to a project.",
    example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  });

const taskSortQuerySchema = z
  .enum(["nextRunAt"])
  .optional()
  .openapi({
    param: { name: "sort", in: "query" },
    description: "Sort tasks by nextRunAt ascending (nulls last)",
    example: "nextRunAt",
  });

const query = z
  .object({
    q: taskNameQuerySchema,
    status: taskStatusQuerySchema,
    scope: taskScopeQuerySchema,
    projectId: projectIdQuerySchema,
    sort: taskSortQuerySchema,
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
    const {
      coworkerId,
      projectId,
      q,
      scope,
      sort,
      status: statuses,
    } = queryParams;
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const searchFilter = q
      ? {
          name: {
            contains: q,
            mode: "insensitive" as const,
          },
        }
      : {};
    const projectFilter =
      projectId === undefined
        ? {}
        : { projectId: projectId === "null" ? null : projectId };

    let where: Prisma.TaskWhereInput;
    if (isCoworkerAuthContext(authContext)) {
      await requireCoworkerCapability(authContext.coworkerId, "tasks");

      if (authContext.delegation) {
        const workspaceContext = requireWorkspaceContext(
          c.var.workspaceContext,
        );
        where = {
          archivedAt: null,
          workspaceId: workspaceContext.workspaceId,
          ...buildDelegatedWorkspaceAwaitingVendorApprovalTaskFilter(
            authContext.coworkerId,
          ),
          ...(scope === "owned"
            ? { userId: authContext.delegation.userId }
            : {}),
          ...(statuses ? { status: { in: statuses } } : {}),
          ...(coworkerId ? { coworkerId } : {}),
          ...projectFilter,
          ...searchFilter,
        };
      } else {
        if (statuses?.includes(TaskStatus.DRAFT)) {
          throw badRequest(
            "Coworkers cannot filter by DRAFT status. DRAFT tasks are not accessible to coworkers.",
          );
        }
        where = {
          coworkerId: authContext.coworkerId,
          archivedAt: null,
          ...(statuses ? { status: { in: statuses } } : {}),
          ...projectFilter,
          ...searchFilter,
          NOT: { status: { in: [TaskStatus.DRAFT] } },
        };
      }
    } else {
      const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
      where = {
        archivedAt: null,
        workspaceId: workspaceContext.workspaceId,
        ...(scope === "workspace"
          ? buildSessionWorkspaceAwaitingVendorApprovalTaskFilter(
              authContext.userId,
            )
          : {}),
        ...(scope === "owned" ? { userId: authContext.userId } : {}),
        ...(statuses ? { status: { in: statuses } } : {}),
        ...(coworkerId ? { coworkerId } : {}),
        ...projectFilter,
        ...searchFilter,
      };
    }

    const takePlusOne = take + 1;
    const orderBy =
      sort === "nextRunAt"
        ? ([
            { nextRunAt: { sort: "asc" as const, nulls: "last" as const } },
            { id: "asc" as const },
          ] as const)
        : ([{ updatedAt: "desc" as const }, { id: "desc" as const }] as const);
    // Read-only list + count: run as independent queries instead of an
    // interactive transaction. The transaction added a 5s timeout that the
    // heavy nested include could exceed (esp. on a cold remote DB), surfacing
    // as a 500. A list view does not need list/count snapshot consistency.
    const [tasks, count] = await Promise.all([
      prisma.task.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [...orderBy],
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
