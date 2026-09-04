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
import {
  refineAssigneeIdAliasConflict,
  resolveAssigneeIdFromRequest,
} from "@/helpers/task-assignee-alias";
import {
  applyTaskListStatusWhere,
  buildTaskListStatusWhere,
} from "@/helpers/task-list-filters";
import {
  buildCoworkerTaskListAccessFilter,
  hasGrantedWorkspaceAccess,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  isCoworkerAuthContext,
  isSokoBotAuthContext,
  requireUserContext,
} from "@/middleware/auth";
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
    assigneeId: z
      .string()
      .optional()
      .openapi({
        param: { name: "assigneeId", in: "query" },
        description: "Filter tasks by assignee coworker ID",
        example: "cow_123",
      }),
    /** @deprecated Use `assigneeId`. */
    coworkerId: z
      .string()
      .optional()
      .openapi({
        param: { name: "coworkerId", in: "query" },
        deprecated: true,
        description: "Deprecated. Use assigneeId instead.",
        example: "cow_123",
      }),
    assigneeSokoBotId: z
      .string()
      .uuid()
      .optional()
      .openapi({
        param: { name: "assigneeSokoBotId", in: "query" },
        description: "Filter tasks by personal-assistant orchestrator assignee",
        example: "01960001-0001-7001-8001-000000000099",
      }),
  })
  .extend(cursorPaginationQuerySchema.shape)
  .superRefine(refineAssigneeIdAliasConflict)
  .transform((data) => {
    const { coworkerId: _coworkerId, ...rest } = data;
    return {
      ...rest,
      assigneeId: resolveAssigneeIdFromRequest(data),
    };
  });

const route = withCoworkerContextHeaderParameters(
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
      assigneeId,
      assigneeSokoBotId,
      projectId,
      q,
      scope,
      sort,
      status: statuses,
    } = queryParams;
    const statusWhere = buildTaskListStatusWhere({
      statuses,
    });
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

      if (statuses?.includes(TaskStatus.DRAFT)) {
        throw badRequest(
          "Coworkers cannot filter by DRAFT status. DRAFT tasks are not accessible to coworkers.",
        );
      }

      const hasWorkspaceGrant = authContext.context
        ? await hasGrantedWorkspaceAccess({
            vendorId: authContext.vendorId,
            workspaceId: requireWorkspaceContext(c.var.workspaceContext)
              .workspaceId,
          })
        : false;

      const listAccessFilter = buildCoworkerTaskListAccessFilter({
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
        hasWorkspaceGrant,
      });

      if (authContext.context) {
        const workspaceContext = requireWorkspaceContext(
          c.var.workspaceContext,
        );
        where = applyTaskListStatusWhere(
          {
            archivedAt: null,
            workspaceId: workspaceContext.workspaceId,
            AND: [listAccessFilter],
            ...(scope === "owned"
              ? { ownerId: authContext.context.userId }
              : {}),
            ...(assigneeId ? { assigneeId } : {}),
            ...(assigneeSokoBotId ? { assigneeSokoBotId } : {}),
            ...projectFilter,
            ...searchFilter,
          },
          statusWhere,
        );
      } else {
        where = applyTaskListStatusWhere(
          {
            archivedAt: null,
            AND: [listAccessFilter],
            ...projectFilter,
            ...searchFilter,
          },
          statusWhere,
        );
      }
    } else if (isSokoBotAuthContext(authContext)) {
      if (statuses?.includes(TaskStatus.DRAFT)) {
        throw badRequest(
          "Soko Bots cannot filter by DRAFT status. DRAFT tasks are not accessible to Soko Bots.",
        );
      }

      where = applyTaskListStatusWhere(
        {
          archivedAt: null,
          workspaceId: authContext.workspaceId,
          assigneeSokoBotId: authContext.sokoBotId,
          status: { not: TaskStatus.DRAFT },
          ...projectFilter,
          ...searchFilter,
        },
        statusWhere,
      );
    } else {
      const userContext = requireUserContext(authContext);
      const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
      where = applyTaskListStatusWhere(
        {
          archivedAt: null,
          workspaceId: workspaceContext.workspaceId,
          ...(scope === "owned" ? { ownerId: userContext.userId } : {}),
          ...(assigneeId ? { assigneeId } : {}),
          ...(assigneeSokoBotId ? { assigneeSokoBotId } : {}),
          ...projectFilter,
          ...searchFilter,
        },
        statusWhere,
      );
    }

    const takePlusOne = take + 1;
    const orderBy =
      sort === "nextRunAt"
        ? ([
            { nextRunAt: { sort: "asc" as const, nulls: "last" as const } },
            { id: "asc" as const },
          ] as const)
        : ([{ updatedAt: "desc" as const }, { id: "desc" as const }] as const);
    // A list view does not need list/count snapshot consistency, so run these
    // as independent queries. The list include uses relation counts instead of
    // loading each task's full event and job graphs.
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
