import { z } from "@hono/zod-openapi";
import {
  CalendarSourceType,
  type Prisma,
  TaskScheduleRunState,
  TaskScheduleState,
  TaskStatus,
} from "@sokosumi/database";

import { getCalendarSourceId } from "@/helpers/calendar-source";
import prisma from "@/lib/db/prisma";
import { workspaceCalendarItemSchema } from "@/schemas/workspace-calendar.schema";
import {
  canWriteTaskSchedule,
  taskScheduleVisibilityWhere,
} from "@/services/task-schedule.service";

import type {
  CalendarCursor,
  CalendarReader,
  WorkspaceCalendarReadOptions,
} from "./read-shared.js";

/** Run ids are UUID columns; only a UUID can break a tie among Runs. */
function hasUuidId(cursor: CalendarCursor): boolean {
  return z.uuid().safeParse(cursor.id).success;
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
 * they do not run until it resumes. Queued Tasks show at their Run at.
 */
export const readTasks: CalendarReader = async ({
  workspaceId,
  userId,
  query,
  options,
}) => {
  const { cursor, from, to } = query;
  const maxCandidates = query.limit + 1;
  const sourceFilter: Prisma.TaskScheduleRunWhereInput = options.sourceId
    ? { sourceType: CalendarSourceType.WORKSPACE }
    : {};
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
            visibility: true,
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
        // The same Runs PATCH /runs/{runId} accepts from this caller.
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

  return {
    items: [...runItems, ...runAtItems],
    total: runTotal + runAtTotal,
  };
};
