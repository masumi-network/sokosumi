import { z } from "@hono/zod-openapi";
import {
  CalendarSourceType,
  type Prisma,
  TaskScheduleOccurrenceState,
  TaskScheduleState,
  TaskStatus,
} from "@sokosumi/database";

import { requireCoworkerCapability } from "@/helpers/access-control";
import { getCalendarSourceId } from "@/helpers/calendar-source";
import { badRequest, notFound } from "@/helpers/error";
import { CALENDAR_OCCURRENCE_HORIZON_MS } from "@/helpers/task-schedule-occurrence-index";
import { buildHumanTaskVisibilityWhere } from "@/helpers/task-visibility";
import {
  buildCoworkerAssigneeAccessWhere,
  buildCoworkerTaskListAccessFilter,
  hasGrantedWorkspaceAccess,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import { type AuthenticationContext } from "@/middleware/auth";
import {
  workspaceCalendarItemSchema,
  workspaceCalendarQuerySchema,
} from "@/schemas/workspace-calendar.schema";

interface CalendarCursor {
  id: string;
  scheduledAt: string;
}

export interface WorkspaceCalendarReadQuery {
  assigneeId?: string;
  assigneeUserId?: string;
  from: Date;
  to: Date;
  cursor: CalendarCursor | null;
  requestedCursor: string | null;
  limit: number;
  scope: "owned" | "workspace";
  status?: TaskStatus;
}

/**
 * What the caller may read: the Task Schedules whose planned Runs it sees,
 * and the Tasks that released Runs created.
 */
export interface CalendarAccessWhere {
  schedule: Prisma.TaskScheduleWhereInput;
  task: Prisma.TaskWhereInput;
}

export interface WorkspaceCalendarReadOptions {
  projectId?: string;
  sourceId?: string;
  access?: CalendarAccessWhere;
}

export async function getCalendarAccessWhere(
  authContext: AuthenticationContext,
  workspaceId: string,
): Promise<CalendarAccessWhere | undefined> {
  if (authContext.actor === "sokoBot") {
    const ownerVisibility = buildHumanTaskVisibilityWhere(authContext.userId);
    return {
      schedule: {
        assigneeSokoBotId: authContext.sokoBotId,
        AND: [ownerVisibility],
      },
      task: {
        archivedAt: null,
        workspaceId,
        assigneeSokoBotId: authContext.sokoBotId,
        status: { not: TaskStatus.DRAFT },
        AND: [ownerVisibility],
      },
    };
  }

  if (authContext.actor !== "coworker") {
    if (authContext.actor === "user") {
      const visibility = buildHumanTaskVisibilityWhere(authContext.userId);
      return { schedule: visibility, task: visibility };
    }
    return undefined;
  }

  await requireCoworkerCapability(authContext.coworkerId, "tasks");
  const hasWorkspaceGrant = authContext.context
    ? await hasGrantedWorkspaceAccess({
        vendorId: authContext.vendorId,
        workspaceId,
      })
    : false;
  const params = {
    coworkerId: authContext.coworkerId,
    vendorId: authContext.vendorId,
    hasWorkspaceGrant,
  };

  return {
    schedule: buildCoworkerAssigneeAccessWhere(params),
    task: { archivedAt: null, ...buildCoworkerTaskListAccessFilter(params) },
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
    assigneeUserId: query.assigneeUserId,
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

function getNonProjectSourceFilter(
  workspaceId: string,
  sourceId: string | undefined,
): Prisma.TaskScheduleOccurrenceWhereInput {
  if (!sourceId) {
    return {};
  }

  if (sourceId === `workspace:${workspaceId}`) {
    return { sourceType: CalendarSourceType.WORKSPACE };
  }

  if (sourceId === `legacy-unknown:${workspaceId}`) {
    return { sourceType: CalendarSourceType.LEGACY_UNKNOWN };
  }

  throw notFound("Calendar source not found");
}

/**
 * The Calendar shows Task Schedule Runs (ADR 0041): planned ones, at their
 * moved time when moved, and released ones through the Task they created.
 * Skipped Runs are left out; planned Runs of a Paused schedule too, since
 * they do not run until it resumes.
 */
export async function readWorkspaceCalendar(
  workspaceId: string,
  userId: string,
  query: WorkspaceCalendarReadQuery,
  options: WorkspaceCalendarReadOptions = {},
) {
  if (options.projectId && options.sourceId) {
    throw badRequest("projectId and sourceId cannot be combined");
  }

  const { cursor, from, to } = query;
  const maxCandidates = query.limit + 1;
  const sourceFilter = getNonProjectSourceFilter(workspaceId, options.sourceId);
  const assigneeFilter = {
    ...(query.scope === "owned" ? { ownerId: userId } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.assigneeUserId ? { assigneeUserId: query.assigneeUserId } : {}),
  };
  const hasAssigneeFilter = Object.keys(assigneeFilter).length > 0;
  const scheduleFilters: Prisma.TaskScheduleWhereInput[] = [
    { state: TaskScheduleState.ACTIVE },
    ...(options.access ? [options.access.schedule] : []),
    ...(hasAssigneeFilter ? [assigneeFilter] : []),
  ];
  const taskFilters: Prisma.TaskWhereInput[] = [
    { archivedAt: null },
    ...(options.access ? [options.access.task] : []),
    ...(hasAssigneeFilter || query.status
      ? [
          {
            ...assigneeFilter,
            ...(query.status ? { status: query.status } : {}),
          },
        ]
      : []),
  ];
  // A planned Run has no Task yet, so it has no status to match.
  const runVisibility: Prisma.TaskScheduleOccurrenceWhereInput = {
    OR: [
      ...(query.status
        ? []
        : [
            {
              state: TaskScheduleOccurrenceState.PLANNED,
              schedule: { is: { AND: scheduleFilters } },
            },
          ]),
      {
        state: TaskScheduleOccurrenceState.RELEASED,
        releasedTask: { is: { AND: taskFilters } },
      },
    ],
  };
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
  const baseWhere: Prisma.TaskScheduleOccurrenceWhereInput = {
    scheduleId: { not: null },
    sourceWorkspaceId: workspaceId,
    ...sourceFilter,
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
    AND: [runVisibility],
  };
  const [runs, total] = await Promise.all([
    prisma.taskScheduleOccurrence.findMany({
      where: cursorFilter
        ? { ...baseWhere, AND: [runVisibility, cursorFilter] }
        : baseWhere,
      take: maxCandidates,
      orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        originalScheduledAt: true,
        effectiveScheduledAt: true,
        state: true,
        sourceWorkspaceId: true,
        sourceType: true,
        sourceProjectId: true,
        sourceAccuracy: true,
        timeAccuracy: true,
        schedule: {
          select: {
            id: true,
            name: true,
            ownerId: true,
            state: true,
            revision: true,
            assigneeId: true,
            assigneeUserId: true,
          },
        },
        releasedTask: {
          select: {
            id: true,
            name: true,
            ownerId: true,
            status: true,
            assigneeId: true,
            assigneeUserId: true,
          },
        },
      },
    }),
    prisma.taskScheduleOccurrence.count({ where: baseWhere }),
  ]);

  const now = new Date();
  const items = runs.flatMap(({ schedule, releasedTask, ...run }) => {
    if (!schedule) {
      return [];
    }
    const task =
      run.state === TaskScheduleOccurrenceState.RELEASED ? releasedTask : null;
    const blueprint = task ?? schedule;
    return [
      workspaceCalendarItemSchema.parse({
        id: run.id,
        scheduleId: schedule.id,
        scheduleRevision: schedule.revision,
        // The same Runs PATCH /runs/{runId} accepts from their owner.
        canChangeRun:
          run.state === TaskScheduleOccurrenceState.PLANNED &&
          schedule.state === TaskScheduleState.ACTIVE &&
          schedule.ownerId === userId &&
          run.effectiveScheduledAt > now,
        taskId: task?.id ?? null,
        taskName: blueprint.name,
        taskStatus: task?.status ?? null,
        taskAssigneeId: blueprint.assigneeId,
        taskAssigneeUserId: blueprint.assigneeUserId,
        taskOwnerId: blueprint.ownerId,
        scheduledAt: run.effectiveScheduledAt.toISOString(),
        originalScheduledAt: run.originalScheduledAt?.toISOString() ?? null,
        state: run.state,
        sourceId: getCalendarSourceId(run),
        sourceWorkspaceId: run.sourceWorkspaceId,
        sourceType: run.sourceType,
        sourceProjectId: run.sourceProjectId,
        sourceAccuracy: run.sourceAccuracy,
        timeAccuracy: run.timeAccuracy,
      }),
    ];
  });
  const page = items.slice(0, query.limit);
  const hasMore = items.length > page.length;

  return {
    items: page,
    pagination: {
      cursor: query.requestedCursor,
      limit: query.limit,
      total,
      nextCursor: hasMore
        ? encodeCursor({
            id: page[page.length - 1]!.id,
            scheduledAt: page[page.length - 1]!.scheduledAt,
          })
        : null,
    },
  };
}
