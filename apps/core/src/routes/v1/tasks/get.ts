import { createRoute, z } from "@hono/zod-openapi";
import { Prisma, TaskStatus, TaskVisibility } from "@sokosumi/database";
import { calendarDateSchema } from "@sokosumi/utils";

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
import { searchTaskList } from "@/helpers/task-list-search";
import { taskTagIdSchema } from "@/helpers/task-tags";
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
  isPersonalSokoBotAuthContext,
  requireUserContext,
} from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { contactActor } from "@/routes/v1/contacts/context";
import { taskStatusSchema } from "@/schemas/domain-enums.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { taskListSchema } from "@/schemas/task.schema";
import { taskListInclude, taskTagSuggestionsForViewer } from "@/types/task";

const taskStatusQuerySchema = z
  .preprocess(
    preprocessMultiValueQueryInput,
    z
      .array(taskStatusSchema)
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
  .enum(["workspace", "owned", "mine"])
  .default("owned")
  .openapi({
    param: { name: "scope", in: "query" },
    description:
      "workspace visibility scope. Defaults to 'owned'. Use 'workspace' to include all tasks in the active workspace, or 'mine' for tasks the caller owns or is assigned to as a workspace member.",
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
  .enum(["createdAt", "updatedAt", "priority", "dueOn"])
  .optional()
  .openapi({
    param: { name: "sort", in: "query" },
    description:
      "createdAt (default): newest created first, which is the date each Task renders. updatedAt: most recently touched first — this is a row-touch column, so a bulk write moves rows and makes cursor pagination unstable. priority: urgent first, none last, then most recently updated. dueOn: earliest due day first, Tasks without one last.",
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

const contactIdQuerySchema = z
  .uuid()
  .optional()
  .openapi({
    param: { name: "contactId", in: "query" },
    description: "Only the Tasks this contact is tagged on",
    example: "01960001-0001-7001-8001-000000000077",
  });

const dueOnToQuerySchema = calendarDateSchema.optional().openapi({
  param: { name: "dueOnTo", in: "query" },
  description:
    "Only Tasks due on or before this day (YYYY-MM-DD). Tasks without a due date are left out.",
  example: "2026-11-10",
});

const statusBeforeQuerySchema = z.iso
  .datetime()
  .optional()
  .openapi({
    param: { name: "statusBefore", in: "query" },
    description:
      "Only Tasks whose status has not changed since this time, for work that has sat in one status a while.",
    example: "2026-11-11T09:00:00.000Z",
  });

const unansweredMentionQuerySchema = z
  .enum(["true", "false"])
  .optional()
  .openapi({
    param: { name: "unansweredMention", in: "query" },
    description:
      "true lists only Tasks where a comment mentions the caller and the caller has not commented since. It narrows the Tasks that `scope` selects, so send scope=workspace to include a teammate's Tasks. It also lists sub-tasks. People only; coworkers and Soko Bots get 400.",
    example: "true",
  });

const archivedQuerySchema = z
  .enum(["true", "false"])
  .optional()
  .openapi({
    param: { name: "archived", in: "query" },
    description:
      "true lists archived Tasks instead, most recently archived first unless sort is given. People only; coworkers and Soko Bots get 400.",
    example: "true",
  });

const parentTaskIdQuerySchema = z
  .string()
  .optional()
  .openapi({
    param: { name: "parentTaskId", in: "query" },
    description:
      "Only the direct sub-tasks of this Task, ordered by position unless sort is given.",
    example: "01960001-0001-7001-8001-000000000001",
  });

const includeSubtasksQuerySchema = z
  .enum(["true", "false"])
  .optional()
  .openapi({
    param: { name: "includeSubtasks", in: "query" },
    description:
      "true also lists sub-tasks. People get only Tasks that are not sub-tasks by default, as the task board shows them; coworkers and Soko Bots always get sub-tasks.",
    example: "true",
  });

const query = z
  .object({
    q: taskNameQuerySchema,
    search: z.string().trim().min(1).max(200).optional().openapi({
      description:
        "Find Tasks by name or identifier first, then by visible tag or description. The selected sort breaks ties within each group.",
    }),
    workspaceTagId: z
      .uuid()
      .optional()
      .openapi({
        param: { name: "workspaceTagId", in: "query" },
        description: "Only Tasks with this workspace tag.",
      }),
    topicTagId: taskTagIdSchema.optional().openapi({
      param: { name: "topicTagId", in: "query" },
      description: "Only Tasks with this visible topic tag.",
    }),
    status: taskStatusQuerySchema,
    scope: taskScopeQuerySchema,
    projectId: projectIdQuerySchema,
    sort: taskSortQuerySchema,
    visibility: taskVisibilityQuerySchema,
    scheduleId: scheduleIdQuerySchema,
    contactId: contactIdQuerySchema,
    dueOnTo: dueOnToQuerySchema,
    statusBefore: statusBeforeQuerySchema,
    archived: archivedQuerySchema,
    parentTaskId: parentTaskIdQuerySchema,
    includeSubtasks: includeSubtasksQuerySchema,
    unansweredMention: unansweredMentionQuerySchema,
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
      archived: archivedParam,
      assigneeId,
      assigneeSokoBotId,
      assigneeUserId,
      contactId,
      dueOnTo,
      includeSubtasks,
      parentTaskId,
      projectId,
      q,
      scheduleId,
      scope,
      sort,
      status: statuses,
      statusBefore,
      unansweredMention: unansweredMentionParam,
      visibility,
    } = queryParams;
    const archived = archivedParam === "true";
    const unansweredMention = unansweredMentionParam === "true";
    const requestedVisibility = visibility === undefined ? {} : { visibility };
    const statusWhere = buildTaskListStatusWhere({
      statuses,
    });
    const { cursor, take } = parseCursorPagination(queryParams);
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
    // Contacts are workspace data: the filter needs a Contacts actor, so a
    // bare Coworker cannot probe which Tasks a contact is tagged on.
    const contactFilter = contactId
      ? {
          contacts: {
            some: {
              contactId,
              contact: { workspaceId: (await contactActor(c)).workspaceId },
            },
          },
        }
      : {};
    // Agents work on sub-tasks assigned to them, so they always see them.
    const agentSubtaskFilter = parentTaskId ? { parentTaskId } : {};
    // A mention on a sub-task still needs an answer, so the mention list
    // keeps sub-tasks. A contact lists every Task it is tagged on.
    const humanSubtaskFilter = parentTaskId
      ? { parentTaskId }
      : includeSubtasks === "true" || unansweredMention || contactId
        ? {}
        : { parentTaskId: null };
    const dueFilter = dueOnTo
      ? { dueOn: { lte: new Date(`${dueOnTo}T00:00:00.000Z`) } }
      : {};
    // Its last status change, or its creation when it never changed, is
    // before the cutoff.
    const statusAgeFilter: Prisma.TaskWhereInput = statusBefore
      ? {
          createdAt: { lt: new Date(statusBefore) },
          events: {
            none: {
              status: { not: null },
              createdAt: { gte: new Date(statusBefore) },
            },
          },
        }
      : {};
    // The caller's own Tasks: those they own, or for "mine" also those
    // assigned to them as a workspace member.
    const scopeFilter = (userId: string): Prisma.TaskWhereInput =>
      scope === "owned"
        ? { ownerId: userId }
        : scope === "mine"
          ? { OR: [{ ownerId: userId }, { assigneeUserId: userId }] }
          : {};

    if (
      archived &&
      (isCoworkerAuthContext(authContext) ||
        isPersonalSokoBotAuthContext(authContext))
    ) {
      throw badRequest("Only people can list archived Tasks.");
    }
    if (
      unansweredMention &&
      (isCoworkerAuthContext(authContext) ||
        isPersonalSokoBotAuthContext(authContext))
    ) {
      throw badRequest("Only people can list Tasks by their mentions.");
    }
    // The person the mention state is read for. Mentions name people, so a
    // coworker or a Soko Bot has none.
    let mentionViewerId: string | null = null;

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
            ...scopeFilter(authContext.context.userId),
            ...(assigneeId ? { assigneeId } : {}),
            ...(assigneeSokoBotId ? { assigneeSokoBotId } : {}),
            ...(assigneeUserId ? { assigneeUserId } : {}),
            ...projectFilter,
            ...scheduleFilter,
            ...contactFilter,
            ...agentSubtaskFilter,
            ...dueFilter,
            ...statusAgeFilter,
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
            ...contactFilter,
            ...agentSubtaskFilter,
            ...dueFilter,
            ...statusAgeFilter,
            ...searchFilter,
          },
          statusWhere,
        );
      }
    } else if (isPersonalSokoBotAuthContext(authContext)) {
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
          ...contactFilter,
          ...agentSubtaskFilter,
          ...dueFilter,
          ...statusAgeFilter,
          ...searchFilter,
        },
        statusWhere,
      );
    } else {
      const userContext = requireUserContext(authContext);
      const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
      mentionViewerId = userContext.userId;
      where = applyTaskListStatusWhere(
        {
          archivedAt: archived ? { not: null } : null,
          workspaceId: workspaceContext.workspaceId,
          ...requestedVisibility,
          AND: [buildHumanTaskVisibilityWhere(userContext.userId)],
          // A Task's checklist shows every sub-task the caller can see,
          // whoever owns it.
          ...(parentTaskId ? {} : scopeFilter(userContext.userId)),
          ...(assigneeId ? { assigneeId } : {}),
          ...(assigneeSokoBotId ? { assigneeSokoBotId } : {}),
          ...(assigneeUserId ? { assigneeUserId } : {}),
          ...projectFilter,
          ...scheduleFilter,
          ...contactFilter,
          ...humanSubtaskFilter,
          ...dueFilter,
          ...statusAgeFilter,
          ...searchFilter,
        },
        statusWhere,
      );
    }

    if (queryParams.workspaceTagId) {
      where.workspaceTags = { some: { labelId: queryParams.workspaceTagId } };
    }
    if (queryParams.topicTagId) {
      where.visibleTopics = { some: { topicId: queryParams.topicTagId } };
    }

    if (unansweredMention && mentionViewerId) {
      where.mentions = {
        some: { userId: mentionViewerId, answeredAt: null },
      };
    }

    const takePlusOne = take + 1;
    // Default to the field the Task cards display. "updatedAt" is Prisma's
    // @updatedAt row touch, so ordering by it floats every row a bulk write
    // touches to the top while the card still shows its real creation date,
    // and it makes cursor pagination unstable: a row updated mid-paging moves
    // between pages, so "Load more" can duplicate or skip rows.
    const orderBy =
      parentTaskId && sort === undefined
        ? ([{ position: "asc" as const }, { id: "asc" as const }] as const)
        : archived && sort === undefined
          ? ([
              { archivedAt: "desc" as const },
              { id: "desc" as const },
            ] as const)
          : sort === "updatedAt"
            ? ([
                { updatedAt: "desc" as const },
                { id: "desc" as const },
              ] as const)
            : sort === "dueOn"
              ? ([{ dueOn: "asc" as const }, { id: "asc" as const }] as const)
              : sort === "priority"
                ? ([
                    { priority: "asc" as const },
                    { updatedAt: "desc" as const },
                    { id: "desc" as const },
                  ] as const)
                : ([
                    { createdAt: "desc" as const },
                    { id: "desc" as const },
                  ] as const);
    // A list view does not need list/count snapshot consistency, so run these
    // as independent queries. The list include uses relation counts instead of
    // loading each task's full event and job graphs.
    function readPage(
      pageWhere: Prisma.TaskWhereInput,
      pageSize: number,
      pageCursor?: string,
    ) {
      return prisma.task.findMany({
        where: pageWhere,
        take: pageSize,
        ...(pageCursor ? { cursor: { id: pageCursor }, skip: 1 } : {}),
        orderBy: [...orderBy],
        include: {
          ...taskListInclude,
          ...taskTagSuggestionsForViewer(
            authContext,
            c.var.workspaceContext?.workspaceId,
          ),
        },
      });
    }
    const [tasks, count] = queryParams.search
      ? await searchTaskList({
          search: queryParams.search,
          workspaceId: c.var.workspaceContext?.workspaceId,
          where,
          take: takePlusOne,
          cursor,
          readPage,
        })
      : await Promise.all([
          readPage(where, takePlusOne, cursor),
          prisma.task.count({ where }),
        ]);

    const hasMore = tasks.length === takePlusOne;
    const pageTasks = tasks.slice(0, take);
    // One indexed read for the page, so the list include stays the same for
    // every kind of caller.
    const unansweredTaskIds =
      mentionViewerId && pageTasks.length > 0
        ? new Set(
            (
              await prisma.taskEventMention.findMany({
                where: {
                  userId: mentionViewerId,
                  answeredAt: null,
                  taskId: { in: pageTasks.map((task) => task.id) },
                },
                select: { taskId: true },
                distinct: ["taskId"],
              })
            ).map((mention) => mention.taskId),
          )
        : null;
    const mappedTasks = pageTasks.map((task) => {
      const { openSubtasks, ...item } = mapTaskListItem(task);
      return {
        ...item,
        // Sub-task names go to people only: a coworker or a Soko Bot can
        // read a Task without being able to read each of its sub-tasks.
        ...(mentionViewerId ? { openSubtasks } : {}),
        ...(unansweredTaskIds
          ? { hasUnansweredMention: unansweredTaskIds.has(task.id) }
          : {}),
      };
    });
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
