import { createRoute, z } from "@hono/zod-openapi";
import {
  Prisma,
  TaskPriority,
  TaskStatus,
  TaskVisibility,
} from "@sokosumi/database";

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
  buildHumanTaskVisibilityWhere,
  buildSokoBotOwnerTaskVisibilityWhere,
} from "@/helpers/task-visibility";
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

type PriorityListCursor = {
  id: string;
  priority: TaskPriority;
  updatedAt: string;
};

function encodePriorityListCursor(item: {
  id: string;
  priority: TaskPriority;
  updatedAt: Date;
}): string {
  return Buffer.from(
    JSON.stringify({
      id: item.id,
      priority: item.priority,
      updatedAt: item.updatedAt.toISOString(),
    }),
    "utf8",
  ).toString("base64url");
}

function isPriorityListCursor(value: unknown): value is PriorityListCursor {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "priority" in value &&
    "updatedAt" in value &&
    typeof value.id === "string" &&
    typeof value.priority === "string" &&
    Object.values(TaskPriority).includes(value.priority as TaskPriority) &&
    typeof value.updatedAt === "string" &&
    !Number.isNaN(new Date(value.updatedAt).getTime())
  );
}

function decodePriorityListCursor(cursor: string): PriorityListCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw badRequest("Invalid pagination cursor");
  }
  if (!isPriorityListCursor(parsed)) {
    throw badRequest("Invalid pagination cursor");
  }
  return parsed;
}

/** Keyset for orderBy priority ASC, updatedAt DESC, id DESC. */
function priorityKeysetWhere(
  cursor: PriorityListCursor,
): Prisma.TaskWhereInput {
  const updatedAt = new Date(cursor.updatedAt);
  const laterPriorities = Object.values(TaskPriority).slice(
    Object.values(TaskPriority).indexOf(cursor.priority) + 1,
  );

  return {
    OR: [
      ...(laterPriorities.length > 0
        ? [{ priority: { in: laterPriorities } }]
        : []),
      {
        AND: [{ priority: cursor.priority }, { updatedAt: { lt: updatedAt } }],
      },
      {
        AND: [
          { priority: cursor.priority },
          { updatedAt },
          { id: { lt: cursor.id } },
        ],
      },
    ],
  };
}

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
  .enum(["createdAt", "updatedAt", "priority"])
  .optional()
  .openapi({
    param: { name: "sort", in: "query" },
    description:
      "createdAt (default): newest created first, which is the date each Task renders. updatedAt: most recently touched first — this is a row-touch column, so a bulk write moves rows and makes cursor pagination unstable. priority: urgent first, none last, then most recently updated; nextCursor encodes priority+updatedAt+id so a mid-page reprioritize does not skip or repeat rows.",
    example: "createdAt",
  });

const taskVisibilityQuerySchema = z
  .enum(TaskVisibility)
  .optional()
  .openapi({
    param: { name: "visibility", in: "query" },
    description:
      "Filter by task visibility. Omitted applies no visibility restriction beyond the caller access predicate. Explicit PUBLIC or PRIVATE narrows the list. PRIVATE still respects the caller visibility predicate.",
    example: TaskVisibility.PUBLIC,
  });

const scheduleIdQuerySchema = z
  .string()
  .uuid()
  .optional()
  .openapi({
    param: { name: "scheduleId", in: "query" },
    description: "Only the Tasks this Task Schedule created",
    example: "01960001-0001-7001-8001-000000000042",
  });

const query = z
  .object({
    q: taskNameQuerySchema,
    status: taskStatusQuerySchema,
    scope: taskScopeQuerySchema,
    projectId: projectIdQuerySchema,
    sort: taskSortQuerySchema,
    visibility: taskVisibilityQuerySchema,
    scheduleId: scheduleIdQuerySchema,
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
        description: "Filter tasks by Soko Bot assignee",
        example: "01960001-0001-7001-8001-000000000099",
      }),
    assigneeUserId: z
      .string()
      .optional()
      .openapi({
        param: { name: "assigneeUserId", in: "query" },
        description: "Filter tasks by workspace-member assignee",
        example: "user_123",
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
    description:
      "List tasks in the active workspace (paginated). Filter by scheduleId for the Tasks a Task Schedule created.",
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
      assigneeUserId,
      projectId,
      q,
      scheduleId,
      scope,
      sort,
      status: statuses,
      visibility,
    } = queryParams;
    const requestedVisibility = visibility === undefined ? {} : { visibility };
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
    const scheduleFilter = scheduleId ? { scheduleId } : {};

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
            ...requestedVisibility,
            AND: [listAccessFilter],
            ...(scope === "owned"
              ? { ownerId: authContext.context.userId }
              : {}),
            ...(assigneeId ? { assigneeId } : {}),
            ...(assigneeSokoBotId ? { assigneeSokoBotId } : {}),
            ...(assigneeUserId ? { assigneeUserId } : {}),
            ...projectFilter,
            ...scheduleFilter,
            ...searchFilter,
          },
          statusWhere,
        );
      } else {
        where = applyTaskListStatusWhere(
          {
            archivedAt: null,
            ...requestedVisibility,
            AND: [listAccessFilter],
            ...projectFilter,
            ...scheduleFilter,
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
          ...requestedVisibility,
          AND: [buildSokoBotOwnerTaskVisibilityWhere(authContext.userId)],
          ...projectFilter,
          ...scheduleFilter,
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
          ...requestedVisibility,
          AND: [buildHumanTaskVisibilityWhere(userContext.userId)],
          ...(scope === "owned" ? { ownerId: userContext.userId } : {}),
          ...(assigneeId ? { assigneeId } : {}),
          ...(assigneeSokoBotId ? { assigneeSokoBotId } : {}),
          ...(assigneeUserId ? { assigneeUserId } : {}),
          ...projectFilter,
          ...scheduleFilter,
          ...searchFilter,
        },
        statusWhere,
      );
    }

    const takePlusOne = take + 1;
    // Default to the field the Task cards display. "updatedAt" is Prisma's
    // @updatedAt row touch, so ordering by it floats every row a bulk write
    // touches to the top while the card still shows its real creation date,
    // and it makes cursor pagination unstable: a row updated mid-paging moves
    // between pages, so "Load more" can duplicate or skip rows.
    const sortByPriority = sort === "priority";
    const orderBy = sortByPriority
      ? ([
          { priority: "asc" as const },
          { updatedAt: "desc" as const },
          { id: "desc" as const },
        ] as const)
      : sort === "updatedAt"
        ? ([{ updatedAt: "desc" as const }, { id: "desc" as const }] as const)
        : ([{ createdAt: "desc" as const }, { id: "desc" as const }] as const);

    let listWhere = where;
    let listSkip = skip;
    let listCursor: { id: string } | undefined = cursor
      ? { id: cursor }
      : undefined;
    let priorityCursor: PriorityListCursor | null = null;

    if (sortByPriority && cursor) {
      // Opaque composite keyset: preferring the encoded boundary keeps the
      // page stable when the page-ending row is reprioritized before "Load more".
      priorityCursor = decodePriorityListCursor(cursor);
      listWhere = { AND: [where, priorityKeysetWhere(priorityCursor)] };
      listSkip = undefined;
      listCursor = undefined;
    }

    // A list view does not need list/count snapshot consistency, so run these
    // as independent queries. The list include uses relation counts instead of
    // loading each task's full event and job graphs.
    const [tasks, count] = await Promise.all([
      prisma.task.findMany({
        where: listWhere,
        take: takePlusOne,
        skip: listSkip,
        cursor: listCursor,
        orderBy: [...orderBy],
        include: taskListInclude,
      }),
      prisma.task.count({ where }),
    ]);

    const hasMore = tasks.length === takePlusOne;
    const pagedTasks = tasks.slice(0, take);
    const mappedTasks = pagedTasks.map((task) => mapTaskListItem(task));
    const paginationMeta = createPaginationMeta(
      mappedTasks,
      count,
      take,
      hasMore,
      cursor,
      sortByPriority
        ? (item) => {
            const source = pagedTasks.find((task) => task.id === item.id);
            if (!source) {
              return item.id;
            }
            return encodePriorityListCursor(source);
          }
        : undefined,
    );

    return ok(c, taskListSchema.parse(mappedTasks), paginationMeta);
  });
}
