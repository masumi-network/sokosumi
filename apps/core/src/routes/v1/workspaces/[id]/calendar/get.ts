import { createRoute, z } from "@hono/zod-openapi";
import {
  CalendarSourceType,
  type Prisma,
  TaskScheduleOccurrenceState,
  TaskStatus,
} from "@sokosumi/database";
import { isNmkrEmail } from "@sokosumi/utils";
import { requireCoworkerCapability } from "@/helpers/access-control";
import { getCalendarSourceId } from "@/helpers/calendar-source";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { badRequest, forbidden, notFound } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { CALENDAR_OCCURRENCE_HORIZON_MS } from "@/helpers/task-schedule-occurrence-index";
import {
  buildCoworkerTaskListAccessFilter,
  hasGrantedWorkspaceAccess,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { type AuthenticationContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  workspaceCalendarItemSchema,
  workspaceCalendarQuerySchema,
} from "@/schemas/workspace-calendar.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "11111111-1111-7111-8111-111111111111",
    }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/calendar",
  description:
    "List indexed planned and released schedule occurrences for a workspace",
  tags: ["Workspaces"],
  request: {
    params: paramsSchema,
    query: workspaceCalendarQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(workspaceCalendarItemSchema),
      "Workspace Calendar items",
      {
        data: [
          {
            id: "v1:tsk_123:2026-06-01T09:00:00.000Z:2026-06-02T09:00:00.000Z",
            taskId: "tsk_123",
            taskName: "Prepare release notes",
            taskStatus: "QUEUED",
            taskAssigneeId: null,
            scheduledAt: "2026-06-02T09:00:00.000Z",
            originalScheduledAt: "2026-06-02T09:00:00.000Z",
            state: "PLANNED",
            sourceWorkspaceId: "11111111-1111-7111-8111-111111111111",
            sourceType: "WORKSPACE",
            sourceProjectId: null,
            sourceAccuracy: "EXACT",
            timeAccuracy: "EXACT",
          },
        ],
        meta: {
          timestamp: "2026-06-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
          pagination: {
            cursor: null,
            limit: 20,
            total: 1,
            nextCursor: null,
          },
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

interface CalendarCursor {
  id: string;
  scheduledAt: string;
}

export interface WorkspaceCalendarReadQuery {
  assigneeId?: string;
  from: Date;
  to: Date;
  cursor: CalendarCursor | null;
  requestedCursor: string | null;
  limit: number;
  scope: "owned" | "workspace";
  status?: TaskStatus;
}

export interface WorkspaceCalendarReadOptions {
  projectId?: string;
  taskWhere?: Prisma.TaskWhereInput;
}

export async function getCalendarTaskWhere(
  authContext: AuthenticationContext,
  workspaceId: string,
): Promise<Prisma.TaskWhereInput | undefined> {
  if (authContext.actor === "sokoBot") {
    return {
      archivedAt: null,
      workspaceId,
      assigneeSokoBotId: authContext.sokoBotId,
      status: { not: TaskStatus.DRAFT },
    };
  }

  if (authContext.actor !== "coworker") {
    return undefined;
  }

  await requireCoworkerCapability(authContext.coworkerId, "tasks");
  const hasWorkspaceGrant = authContext.context
    ? await hasGrantedWorkspaceAccess({
        vendorId: authContext.vendorId,
        workspaceId,
      })
    : false;

  return {
    archivedAt: null,
    ...buildCoworkerTaskListAccessFilter({
      coworkerId: authContext.coworkerId,
      vendorId: authContext.vendorId,
      hasWorkspaceGrant,
    }),
  };
}

function encodeCursor(item: { id: string; scheduledAt: string }): string {
  return Buffer.from(JSON.stringify(item), "utf8").toString("base64url");
}

function isCalendarCursor(value: unknown): value is CalendarCursor {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "scheduledAt" in value &&
    typeof value.id === "string" &&
    typeof value.scheduledAt === "string" &&
    !Number.isNaN(new Date(value.scheduledAt).getTime())
  );
}

function decodeCursor(cursor: string): CalendarCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw badRequest("cursor is invalid");
  }
  if (!isCalendarCursor(parsed)) {
    throw badRequest("cursor is invalid");
  }
  return parsed;
}

function validateRange(from: string, to: string): { from: Date; to: Date } {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    toDate <= fromDate
  ) {
    throw badRequest("to must be after from");
  }
  if (toDate.getTime() - fromDate.getTime() > CALENDAR_OCCURRENCE_HORIZON_MS) {
    throw badRequest("Calendar range cannot exceed 90 days");
  }
  if (toDate.getTime() > Date.now() + CALENDAR_OCCURRENCE_HORIZON_MS) {
    throw badRequest(
      "Calendar browse range cannot extend beyond the next 90 days",
    );
  }
  return { from: fromDate, to: toDate };
}

export function parseWorkspaceCalendarQuery(
  query: z.infer<typeof workspaceCalendarQuerySchema>,
): WorkspaceCalendarReadQuery {
  const { from, to } = validateRange(query.from, query.to);
  return {
    assigneeId: query.assigneeId,
    from,
    to,
    cursor: query.cursor ? decodeCursor(query.cursor) : null,
    requestedCursor: query.cursor ?? null,
    limit: query.limit,
    scope: query.scope,
    status: query.status,
  };
}

function isPersistedOccurrenceCursor(
  cursor: CalendarCursor | null,
): cursor is CalendarCursor {
  return cursor !== null && z.uuid().safeParse(cursor.id).success;
}

export async function readWorkspaceCalendar(
  workspaceId: string,
  userId: string,
  query: WorkspaceCalendarReadQuery,
  options: WorkspaceCalendarReadOptions = {},
) {
  const { cursor, from, to } = query;
  const maxCandidates = query.limit + 1;
  const taskFilters: Prisma.TaskWhereInput[] = [
    { archivedAt: null },
    ...(options.taskWhere ? [options.taskWhere] : []),
    ...(query.scope === "owned" || query.assigneeId || query.status
      ? [
          {
            ...(query.scope === "owned" ? { ownerId: userId } : {}),
            ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
            ...(query.status ? { status: query.status } : {}),
          },
        ]
      : []),
  ];
  const taskVisibilityFilters: Prisma.TaskScheduleOccurrenceWhereInput[] =
    taskFilters.map((taskWhere) => ({
      OR: [
        {
          state: TaskScheduleOccurrenceState.PLANNED,
          seriesTask: { is: taskWhere },
        },
        {
          state: TaskScheduleOccurrenceState.RELEASED,
          releasedTask: { is: taskWhere },
        },
        {
          state: TaskScheduleOccurrenceState.RELEASED,
          releasedTaskId: null,
          seriesTask: { is: taskWhere },
        },
      ],
    }));
  const cursorFilter: Prisma.TaskScheduleOccurrenceWhereInput | null = cursor
    ? {
        OR: [
          { effectiveScheduledAt: { gt: new Date(cursor.scheduledAt) } },
          ...(isPersistedOccurrenceCursor(cursor)
            ? [
                {
                  effectiveScheduledAt: new Date(cursor.scheduledAt),
                  id: { gt: cursor.id },
                },
              ]
            : []),
        ],
      }
    : null;
  const persistedOccurrenceBaseWhere = {
    sourceWorkspaceId: workspaceId,
    ...(options.projectId
      ? {
          sourceProjectId: options.projectId,
          sourceType: CalendarSourceType.PROJECT,
        }
      : {}),
    state: {
      in: [
        TaskScheduleOccurrenceState.PLANNED,
        TaskScheduleOccurrenceState.RELEASED,
      ],
    },
    effectiveScheduledAt: { gte: from, lt: to },
    ...(taskVisibilityFilters.length > 0 ? { AND: taskVisibilityFilters } : {}),
  };
  const persistedOccurrenceWhere = {
    ...persistedOccurrenceBaseWhere,
    ...(cursorFilter
      ? taskVisibilityFilters.length > 0
        ? { AND: [...taskVisibilityFilters, cursorFilter] }
        : cursorFilter
      : {}),
  };
  const [occurrences, persistedOccurrenceCount] = await Promise.all([
    prisma.taskScheduleOccurrence.findMany({
      where: persistedOccurrenceWhere,
      take: maxCandidates,
      orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        seriesTaskId: true,
        originalScheduledAt: true,
        effectiveScheduledAt: true,
        state: true,
        sourceWorkspaceId: true,
        sourceType: true,
        sourceProjectId: true,
        sourceAccuracy: true,
        timeAccuracy: true,
        epochId: true,
        seriesTask: {
          select: {
            id: true,
            name: true,
            status: true,
            assigneeId: true,
          },
        },
        releasedTask: {
          select: {
            id: true,
            name: true,
            status: true,
            assigneeId: true,
          },
        },
      },
    }),
    prisma.taskScheduleOccurrence.count({
      where: persistedOccurrenceBaseWhere,
    }),
  ]);

  const persistedItems = occurrences
    .slice(0, maxCandidates)
    .map((occurrence) => {
      const task =
        occurrence.state === TaskScheduleOccurrenceState.RELEASED &&
        occurrence.releasedTask
          ? occurrence.releasedTask
          : occurrence.seriesTask;

      return workspaceCalendarItemSchema.parse({
        id: occurrence.id,
        taskId: task.id,
        taskName: task.name,
        taskStatus: task.status,
        taskAssigneeId: task.assigneeId,
        scheduledAt: occurrence.effectiveScheduledAt.toISOString(),
        originalScheduledAt:
          occurrence.originalScheduledAt?.toISOString() ?? null,
        state: occurrence.state,
        sourceId: getCalendarSourceId(occurrence),
        sourceWorkspaceId: occurrence.sourceWorkspaceId,
        sourceType: occurrence.sourceType,
        sourceProjectId: occurrence.sourceProjectId,
        sourceAccuracy: occurrence.sourceAccuracy,
        timeAccuracy: occurrence.timeAccuracy,
      });
    });
  const page = persistedItems.slice(0, query.limit);
  const hasMore = persistedItems.length > page.length;

  return {
    items: page,
    pagination: {
      cursor: query.requestedCursor,
      limit: query.limit,
      total: persistedOccurrenceCount,
      nextCursor: hasMore
        ? encodeCursor({
            id: page[page.length - 1]!.id,
            scheduledAt: page[page.length - 1]!.scheduledAt,
          })
        : null,
    },
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = await requireAuthorizedUserContext(c.var.authContext);
    const user = await prisma.user.findUnique({
      where: { id: userContext.userId },
      select: { email: true },
    });
    if (!isNmkrEmail(user?.email)) {
      throw forbidden("Calendar is only available to NMKR users");
    }
    const { id: workspaceId } = c.req.valid("param");
    if (userContext.source === "context") {
      const activeWorkspace = requireWorkspaceContext(c.var.workspaceContext);
      if (activeWorkspace.workspaceId !== workspaceId) {
        throw forbidden("You can only access the active workspace calendar");
      }
    }
    const query = c.req.valid("query");
    const calendarQuery = parseWorkspaceCalendarQuery(query);

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        userId: true,
        organizationId: true,
      },
    });
    if (!workspace) {
      throw notFound("Workspace not found");
    }
    if (workspace.organizationId) {
      await resolveMemberOrganizationById({
        id: workspace.organizationId,
        userId: userContext.userId,
        tx: prisma,
      });
    } else if (workspace.userId !== userContext.userId) {
      throw forbidden("You do not have access to this workspace");
    }

    const taskWhere = await getCalendarTaskWhere(
      c.var.authContext,
      workspaceId,
    );
    const { items, pagination } = await readWorkspaceCalendar(
      workspaceId,
      userContext.userId,
      calendarQuery,
      { taskWhere },
    );

    return ok(c, items, pagination);
  });
}
