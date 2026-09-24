import { z } from "@hono/zod-openapi";
import {
  CalendarSourceType,
  type Prisma,
  TaskScheduleRunState,
  TaskScheduleState,
  TaskStatus,
} from "@sokosumi/database";

import { requireCoworkerCapability } from "@/helpers/access-control";
import { getCalendarSourceId } from "@/helpers/calendar-source";
import { badRequest, notFound } from "@/helpers/error";
import { parseSocialPostMedia } from "@/helpers/social-post-media";
import {
  buildHumanTaskVisibilityWhere,
  buildSokoBotOwnerTaskVisibilityWhere,
} from "@/helpers/task-visibility";
import {
  buildCoworkerTaskListAccessFilter,
  hasGrantedWorkspaceAccess,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import { type AuthenticationContext } from "@/middleware/auth";
import {
  socialPostCalendarItemSchema,
  workspaceCalendarEntrySchema,
  workspaceCalendarItemSchema,
  workspaceCalendarQuerySchema,
} from "@/schemas/workspace-calendar.schema";
import {
  canWriteTaskSchedule,
  type TaskScheduleReader,
  taskScheduleVisibilityWhere,
} from "@/services/task-schedule.service";
import { RUN_HORIZON_MS } from "@/services/task-schedule-runs.service";

interface CalendarCursor {
  id: string;
  scheduledAt: string;
}

export interface WorkspaceCalendarReadQuery {
  includeSocialPosts?: boolean;
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
 * What the caller may read: the Tasks that released Runs created, and, as
 * `scheduleReader`, whose Task Schedules' planned Runs it sees and changes
 * (by the Task Schedule rules). A null reader sees no planned Runs.
 */
export interface CalendarAccessWhere {
  scheduleReader: TaskScheduleReader | null;
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
  // Soko Bots do not work with Task Schedules; they see the Tasks created.
  if (authContext.actor === "sokoBot") {
    return {
      scheduleReader: null,
      task: {
        archivedAt: null,
        workspaceId,
        assigneeSokoBotId: authContext.sokoBotId,
        status: { not: TaskStatus.DRAFT },
        AND: [buildSokoBotOwnerTaskVisibilityWhere(authContext.userId)],
      },
    };
  }

  if (authContext.actor !== "coworker") {
    if (authContext.actor === "user") {
      return {
        scheduleReader: { kind: "user", userId: authContext.userId },
        task: buildHumanTaskVisibilityWhere(authContext.userId),
      };
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

  return {
    // A Coworker reads Task Schedules only with a GRANTED workspace grant.
    scheduleReader:
      hasWorkspaceGrant && authContext.context
        ? {
            kind: "coworker",
            coworkerId: authContext.coworkerId,
            vendorId: authContext.vendorId,
            userId: authContext.context.userId,
          }
        : null,
    task: {
      archivedAt: null,
      ...buildCoworkerTaskListAccessFilter({
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
        hasWorkspaceGrant,
      }),
    },
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
  if (toDate.getTime() - fromDate.getTime() > RUN_HORIZON_MS) {
    throw badRequest("Calendar range cannot exceed 90 days");
  }
  if (toDate.getTime() > Date.now() + RUN_HORIZON_MS) {
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
    includeSocialPosts: query.includeSocialPosts === "true",
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

/** Run ids are UUID columns; only a UUID can break a tie among Runs. */
function hasUuidId(cursor: CalendarCursor): boolean {
  return z.uuid().safeParse(cursor.id).success;
}

function getNonProjectSourceFilter(
  workspaceId: string,
  sourceId: string | undefined,
): Prisma.TaskScheduleRunWhereInput {
  if (!sourceId) {
    return {};
  }

  if (sourceId === `workspace:${workspaceId}`) {
    return { sourceType: CalendarSourceType.WORKSPACE };
  }

  throw notFound("Calendar source not found");
}

/** Run at Tasks have a Project or the workspace as source. */
function getRunAtTaskSourceFilter(
  workspaceId: string,
  options: WorkspaceCalendarReadOptions,
): Prisma.TaskWhereInput | null {
  if (options.projectId) {
    return { projectId: options.projectId };
  }
  if (!options.sourceId) {
    return {};
  }
  return options.sourceId === `workspace:${workspaceId}`
    ? { projectId: null }
    : null;
}

/**
 * The Calendar shows Task Schedule Runs (ADR 0041): planned ones, at their
 * moved time when moved, and released ones through the Task they created.
 * Skipped Runs are left out; planned Runs of a Paused schedule too, since
 * they do not run until it resumes. Queued Tasks show at their Run at. Both
 * kinds page together by time, then id.
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
  const scheduleReader = options.access?.scheduleReader;
  const scheduleFilters: Prisma.TaskScheduleWhereInput[] = [
    { state: TaskScheduleState.ACTIVE },
    ...(scheduleReader ? [taskScheduleVisibilityWhere(scheduleReader)] : []),
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
  const showsPlannedRuns = !query.status && scheduleReader !== null;
  const runVisibility: Prisma.TaskScheduleRunWhereInput = {
    OR: [
      ...(!showsPlannedRuns
        ? []
        : [
            {
              state: TaskScheduleRunState.PLANNED,
              schedule: { is: { AND: scheduleFilters } },
            },
          ]),
      {
        state: TaskScheduleRunState.RELEASED,
        releasedTask: { is: { AND: taskFilters } },
      },
    ],
  };
  const cursorFilter: Prisma.TaskScheduleRunWhereInput | null = cursor
    ? {
        OR: [
          { effectiveScheduledAt: { gt: new Date(cursor.scheduledAt) } },
          ...(hasUuidId(cursor)
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
  const baseWhere: Prisma.TaskScheduleRunWhereInput = {
    sourceWorkspaceId: workspaceId,
    ...sourceFilter,
    ...(options.projectId
      ? {
          sourceProjectId: options.projectId,
          sourceType: CalendarSourceType.PROJECT,
        }
      : {}),
    state: {
      in: [TaskScheduleRunState.PLANNED, TaskScheduleRunState.RELEASED],
    },
    effectiveScheduledAt: { gte: from, lt: to },
    AND: [runVisibility],
  };
  const runAtSourceFilter = getRunAtTaskSourceFilter(workspaceId, options);
  const runAtTaskWhere: Prisma.TaskWhereInput | null =
    runAtSourceFilter && (!query.status || query.status === TaskStatus.QUEUED)
      ? {
          workspaceId,
          status: TaskStatus.QUEUED,
          runAt: { gte: from, lt: to },
          ...runAtSourceFilter,
          AND: taskFilters,
        }
      : null;
  const runAtCursorFilter: Prisma.TaskWhereInput | null = cursor
    ? {
        OR: [
          { runAt: { gt: new Date(cursor.scheduledAt) } },
          { runAt: new Date(cursor.scheduledAt), id: { gt: cursor.id } },
        ],
      }
    : null;
  const [runs, runTotal, runAtTasks, runAtTotal] = await Promise.all([
    prisma.taskScheduleRun.findMany({
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
        schedule: {
          select: {
            id: true,
            name: true,
            ownerId: true,
            state: true,
            revision: true,
            creatorCoworkerId: true,
            assigneeId: true,
            assigneeUserId: true,
            assignee: { select: { vendorId: true } },
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
    prisma.taskScheduleRun.count({ where: baseWhere }),
    runAtTaskWhere
      ? prisma.task.findMany({
          where: runAtCursorFilter
            ? { ...runAtTaskWhere, AND: [...taskFilters, runAtCursorFilter] }
            : runAtTaskWhere,
          take: maxCandidates,
          orderBy: [{ runAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            name: true,
            ownerId: true,
            status: true,
            assigneeId: true,
            assigneeUserId: true,
            runAt: true,
            workspaceId: true,
            projectId: true,
          },
        })
      : [],
    runAtTaskWhere ? prisma.task.count({ where: runAtTaskWhere }) : 0,
  ]);

  const now = new Date();
  const runItems = runs.flatMap(({ schedule, releasedTask, ...run }) => {
    if (!schedule) {
      return [];
    }
    const task =
      run.state === TaskScheduleRunState.RELEASED ? releasedTask : null;
    const blueprint = task ?? schedule;
    return [
      workspaceCalendarItemSchema.parse({
        id: run.id,
        kind: "RUN",
        scheduleId: schedule.id,
        scheduleRevision: schedule.revision,
        // The same Runs PATCH /runs/{runId} accepts from their owner.
        canChangeRun:
          run.state === TaskScheduleRunState.PLANNED &&
          schedule.state === TaskScheduleState.ACTIVE &&
          run.effectiveScheduledAt > now &&
          scheduleReader != null &&
          canWriteTaskSchedule(scheduleReader, schedule),
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
      }),
    ];
  });
  const runAtItems = runAtTasks.flatMap(({ runAt, ...task }) => {
    if (!runAt) {
      return [];
    }
    const source = {
      sourceWorkspaceId: task.workspaceId,
      sourceType: task.projectId
        ? CalendarSourceType.PROJECT
        : CalendarSourceType.WORKSPACE,
      sourceProjectId: task.projectId,
    };
    return [
      workspaceCalendarItemSchema.parse({
        id: task.id,
        kind: "RUN_AT",
        scheduleId: null,
        scheduleRevision: null,
        canChangeRun: false,
        taskId: task.id,
        taskName: task.name,
        taskStatus: task.status,
        taskAssigneeId: task.assigneeId,
        taskAssigneeUserId: task.assigneeUserId,
        taskOwnerId: task.ownerId,
        scheduledAt: runAt.toISOString(),
        originalScheduledAt: null,
        state: TaskScheduleRunState.PLANNED,
        sourceId: getCalendarSourceId(source),
        ...source,
      }),
    ];
  });
  const includePosts =
    query.includeSocialPosts &&
    !options.sourceId &&
    !query.assigneeId &&
    !query.assigneeUserId &&
    !query.status;
  const socialBaseWhere: Prisma.SocialPostWhereInput = {
    workspaceId,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(query.scope === "owned" ? { scheduledByUserId: userId } : {}),
    status: { not: "DRAFT" },
    scheduledAt: { gte: from, lt: to },
  };
  const socialCursor: Prisma.SocialPostWhereInput = cursor
    ? {
        OR: [
          { scheduledAt: { gt: new Date(cursor.scheduledAt) } },
          {
            scheduledAt: new Date(cursor.scheduledAt),
            ...(cursor.id.startsWith("social:")
              ? { id: { gt: cursor.id.slice(7) } }
              : {}),
          },
        ],
      }
    : {};
  const [posts, postCount] = includePosts
    ? await Promise.all([
        prisma.socialPost.findMany({
          where: { ...socialBaseWhere, ...socialCursor },
          take: maxCandidates,
          orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            text: true,
            status: true,
            scheduledAt: true,
            projectId: true,
            workspaceId: true,
            socialConnection: { select: { externalHandle: true } },
            project: { select: { name: true } },
            scheduledByUser: { select: { name: true, image: true } },
            media: true,
          },
        }),
        prisma.socialPost.count({ where: socialBaseWhere }),
      ])
    : [[], 0];
  const socialItems = posts.map((post) =>
    socialPostCalendarItemSchema.parse({
      kind: "socialPost",
      id: `social:${post.id}`,
      postId: post.id,
      text: post.text,
      status: post.status,
      externalHandle: post.socialConnection?.externalHandle ?? null,
      projectName: post.project.name,
      scheduledByName: post.scheduledByUser?.name ?? null,
      scheduledByImage: post.scheduledByUser?.image ?? null,
      attachmentCount: parseSocialPostMedia(post.media, post.id).length,
      scheduledAt: post.scheduledAt?.toISOString(),
      sourceId: `project:${post.projectId}`,
      sourceProjectId: post.projectId,
      sourceWorkspaceId: post.workspaceId,
      sourceType: "PROJECT",
    }),
  );
  const merged: z.infer<typeof workspaceCalendarEntrySchema>[] = [
    ...runItems,
    ...runAtItems,
    ...socialItems,
  ];
  merged.sort(
    (a, b) =>
      a.scheduledAt.localeCompare(b.scheduledAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const page = merged.slice(0, query.limit);
  const hasMore = merged.length > page.length;

  return {
    items: page,
    pagination: {
      cursor: query.requestedCursor,
      limit: query.limit,
      total: runTotal + runAtTotal + postCount,
      nextCursor: hasMore
        ? encodeCursor({
            id: page[page.length - 1]!.id,
            scheduledAt: page[page.length - 1]!.scheduledAt,
          })
        : null,
    },
  };
}
