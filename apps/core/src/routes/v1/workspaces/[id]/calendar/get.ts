import { createRoute, z } from "@hono/zod-openapi";
import {
  CalendarSourceAccuracy,
  CalendarSourceType,
  CalendarTimeAccuracy,
  TaskScheduleOccurrenceState,
  TaskStatus,
} from "@sokosumi/database";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { badRequest, forbidden, notFound } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { projectTaskScheduleOccurrences } from "@/helpers/task-schedule";
import { validatePersistedTaskSchedule } from "@/helpers/task-schedule-validation";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  workspaceCalendarItemSchema,
  workspaceCalendarQuerySchema,
} from "@/schemas/workspace-calendar.schema";

const MAX_CALENDAR_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
const CALENDAR_SOURCE_READ_MULTIPLIER = 10;

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
    "List scheduled Task projections and persisted schedule occurrences for a workspace",
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
            id: "v1:2026-06-01T09:00:00.000Z:2026-06-02T09:00:00.000Z",
            taskId: "tsk_123",
            taskName: "Prepare release notes",
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
  from: Date;
  to: Date;
  cursor: CalendarCursor | null;
  requestedCursor: string | null;
  limit: number;
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
  if (toDate.getTime() - fromDate.getTime() > MAX_CALENDAR_RANGE_MS) {
    throw badRequest("Calendar range cannot exceed 90 days");
  }
  return { from: fromDate, to: toDate };
}

export function parseWorkspaceCalendarQuery(
  query: z.infer<typeof workspaceCalendarQuerySchema>,
): WorkspaceCalendarReadQuery {
  const { from, to } = validateRange(query.from, query.to);
  return {
    from,
    to,
    cursor: query.cursor ? decodeCursor(query.cursor) : null,
    requestedCursor: query.cursor ?? null,
    limit: query.limit,
  };
}

function compareCalendarItems(
  left: { id: string; scheduledAt: string },
  right: { id: string; scheduledAt: string },
): number {
  return (
    new Date(left.scheduledAt).getTime() -
      new Date(right.scheduledAt).getTime() || left.id.localeCompare(right.id)
  );
}

export async function readWorkspaceCalendar(
  workspaceId: string,
  query: WorkspaceCalendarReadQuery,
) {
  const { cursor, from, to } = query;
  // Calendar projections are calculated in application code. Keep every source
  // collection and the merged result bounded by the requested page size.
  const sourceReadLimit = query.limit * CALENDAR_SOURCE_READ_MULTIPLIER;
  const sourceTake = sourceReadLimit + 1;

  const [scheduledTasks, occurrences] = await Promise.all([
    prisma.task.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        status: TaskStatus.QUEUED,
        metadata: { not: null },
        nextRunAt: { not: null },
        scheduleQuarantine: null,
      },
      take: sourceTake,
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        workspaceId: true,
        projectId: true,
        status: true,
        metadata: true,
        nextRunAt: true,
      },
    }),
    prisma.taskScheduleOccurrence.findMany({
      where: {
        sourceWorkspaceId: workspaceId,
        effectiveScheduledAt: { gte: from, lt: to },
      },
      take: sourceTake,
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
          },
        },
      },
    }),
  ]);

  if (
    scheduledTasks.length > sourceReadLimit ||
    occurrences.length > sourceReadLimit
  ) {
    throw badRequest(
      "Calendar range contains too many schedule sources; narrow the date range",
    );
  }

  const persistedEpochOccurrences = new Set(
    occurrences.flatMap((occurrence) =>
      occurrence.epochId && occurrence.originalScheduledAt
        ? [
            `${occurrence.seriesTaskId}:${occurrence.epochId}:${occurrence.originalScheduledAt.toISOString()}`,
          ]
        : [],
    ),
  );

  const items: z.infer<typeof workspaceCalendarItemSchema>[] = [];

  function addItem(item: z.infer<typeof workspaceCalendarItemSchema>) {
    if (items.length === sourceReadLimit) {
      throw badRequest(
        "Calendar range contains too many items; narrow the date range",
      );
    }
    items.push(item);
  }

  for (const task of scheduledTasks) {
    const validation = validatePersistedTaskSchedule(task);
    if (!validation.valid || !task.nextRunAt) {
      continue;
    }

    const projections = projectTaskScheduleOccurrences(
      validation.metadata,
      task.nextRunAt,
      from,
      to,
      sourceReadLimit - items.length + 1,
    );
    for (const projection of projections) {
      if (
        validation.metadata.version !== 1 &&
        persistedEpochOccurrences.has(
          `${task.id}:${validation.metadata.epochId}:${projection.originalScheduledAt.toISOString()}`,
        )
      ) {
        continue;
      }
      addItem(
        workspaceCalendarItemSchema.parse({
          id: projection.id,
          taskId: task.id,
          taskName: task.name,
          scheduledAt: projection.scheduledAt.toISOString(),
          originalScheduledAt: projection.originalScheduledAt.toISOString(),
          state: TaskScheduleOccurrenceState.PLANNED,
          sourceWorkspaceId: task.workspaceId,
          sourceType: task.projectId
            ? CalendarSourceType.PROJECT
            : CalendarSourceType.WORKSPACE,
          sourceProjectId: task.projectId,
          sourceAccuracy: CalendarSourceAccuracy.EXACT,
          timeAccuracy: CalendarTimeAccuracy.EXACT,
        }),
      );
    }
  }

  for (const occurrence of occurrences) {
    addItem(
      workspaceCalendarItemSchema.parse({
        id: occurrence.id,
        taskId: occurrence.seriesTask.id,
        taskName: occurrence.seriesTask.name,
        scheduledAt: occurrence.effectiveScheduledAt.toISOString(),
        originalScheduledAt:
          occurrence.originalScheduledAt?.toISOString() ?? null,
        state: occurrence.state,
        sourceWorkspaceId: occurrence.sourceWorkspaceId,
        sourceType: occurrence.sourceType,
        sourceProjectId: occurrence.sourceProjectId,
        sourceAccuracy: occurrence.sourceAccuracy,
        timeAccuracy: occurrence.timeAccuracy,
      }),
    );
  }

  const sortedItems = items
    .sort(compareCalendarItems)
    .map((item) => workspaceCalendarItemSchema.parse(item));

  const itemsAfterCursor = cursor
    ? sortedItems.filter((item) => compareCalendarItems(item, cursor) > 0)
    : sortedItems;
  const page = itemsAfterCursor.slice(0, query.limit);
  const hasMore = itemsAfterCursor.length > page.length;

  return {
    items: page,
    pagination: {
      cursor: query.requestedCursor,
      limit: query.limit,
      total: sortedItems.length,
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
    },
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = await requireAuthorizedUserContext(c.var.authContext);
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

    const { items, pagination } = await readWorkspaceCalendar(
      workspaceId,
      calendarQuery,
    );

    return ok(c, items, pagination);
  });
}
