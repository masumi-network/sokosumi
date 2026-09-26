import { z } from "@hono/zod-openapi";
import {
  type Task,
  type TaskSchedule,
  TaskScheduleState,
  TaskStatus,
  type TaskVisibility,
} from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

import { migratedTaskScheduleId, shimCreateOperationId } from "./ids";
import { LEGACY_HOLD_RUN_AT, legacyRecurringSpec } from "./rule";

/** A Task as the old API showed it, with its schedule in `metadata` and `nextRunAt`. */
export interface LegacyTaskView {
  id: string;
  scheduleId: string | null;
  ownerId: string;
  userId: string;
  name: string;
  description: string | null;
  status: TaskStatus;
  credits: number;
  coworkerId: string | null;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  organizationId: string | null;
  workspaceId: string;
  projectId: string | null;
  visibility: TaskVisibility;
  runAt: string | null;
  metadata: string | null;
  nextRunAt: string | null;
  scheduleRevision: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A Task Schedule as the old API showed its template Task: Queued, with the
 * rule in `metadata` and the next Run in `nextRunAt`. A paused schedule
 * shows the hold these clients paused with; an ended one shows Canceled.
 */
export function legacySeriesView(
  schedule: TaskSchedule,
  legacyId: string,
): LegacyTaskView {
  const ended = schedule.state === TaskScheduleState.ENDED;
  const paused = schedule.state === TaskScheduleState.PAUSED;
  const spec = paused
    ? { mode: "once", runAt: LEGACY_HOLD_RUN_AT }
    : legacyRecurringSpec(schedule);
  return {
    id: legacyId,
    scheduleId: schedule.id,
    ownerId: schedule.ownerId,
    userId: schedule.ownerId,
    name: schedule.name,
    description: schedule.description,
    status: ended ? TaskStatus.CANCELED : TaskStatus.QUEUED,
    credits: 0,
    coworkerId: schedule.assigneeId,
    assigneeId: schedule.assigneeId,
    assigneeSokoBotId: schedule.assigneeSokoBotId,
    organizationId: schedule.organizationId,
    workspaceId: schedule.workspaceId,
    projectId: schedule.projectId,
    visibility: schedule.visibility,
    runAt: null,
    metadata: ended ? null : JSON.stringify(spec),
    nextRunAt: ended
      ? null
      : paused
        ? LEGACY_HOLD_RUN_AT
        : (schedule.nextRunAt?.toISOString() ?? null),
    scheduleRevision: schedule.revision,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

/** A one-time Task as the old API showed it: its Run at as a once rule. */
export function withLegacyOnceFields<
  T extends { status?: unknown; runAt?: unknown },
>(task: T): T & { metadata?: string | null; nextRunAt?: unknown } {
  if (task.status !== TaskStatus.QUEUED || typeof task.runAt !== "string") {
    return task;
  }
  return {
    ...task,
    metadata: JSON.stringify({ mode: "once", runAt: task.runAt }),
    nextRunAt: task.runAt,
  };
}

const taskDtoSchema = z
  .object({ status: z.unknown(), runAt: z.unknown() })
  .loose();

/** Adds the old once fields to the Task, or each Task, a route answered. */
export function withLegacyOnceFieldsOnData(data: unknown): unknown {
  const enrich = (item: unknown) => {
    const parsed = taskDtoSchema.safeParse(item);
    return parsed.success ? withLegacyOnceFields(parsed.data) : item;
  };
  return Array.isArray(data) ? data.map(enrich) : enrich(data);
}

export function legacyTaskView(task: Task): LegacyTaskView {
  return withLegacyOnceFields({
    id: task.id,
    scheduleId: task.scheduleId,
    ownerId: task.ownerId,
    userId: task.ownerId,
    name: task.name ?? "",
    description: task.description,
    status: task.status,
    credits: 0,
    coworkerId: task.assigneeId,
    assigneeId: task.assigneeId,
    assigneeSokoBotId: task.assigneeSokoBotId,
    organizationId: task.organizationId,
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    visibility: task.visibility,
    runAt: task.runAt?.toISOString() ?? null,
    metadata: null,
    nextRunAt: null,
    scheduleRevision: 0,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  });
}

const guidSchema = z.guid();

/**
 * The Task Schedule an old per-Task id names in the workspace: the schedule
 * id itself, the template Task the cutover moved, or the Task a PUT made a
 * schedule from. Not yet checked for the caller.
 */
export async function resolveLegacySeries(
  id: string,
  workspaceId: string,
): Promise<TaskSchedule | null> {
  // TaskSchedule.id is a Postgres uuid: any other id fails the cast.
  const ids = guidSchema.safeParse(id).success
    ? [id, migratedTaskScheduleId(id)]
    : [migratedTaskScheduleId(id)];
  const direct = await prisma.taskSchedule.findFirst({
    where: { id: { in: ids }, workspaceId },
  });
  if (direct) {
    return direct;
  }
  const shimCreated = await prisma.taskScheduleCreateOperation.findUnique({
    where: {
      workspaceId_operationId: {
        workspaceId,
        operationId: shimCreateOperationId(id),
      },
    },
    select: { schedule: true },
  });
  return shimCreated?.schedule ?? null;
}

/** A day covers the create-then-PUT these clients do. */
const SHIM_BLUEPRINT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The id each schedule's old client knows it by: the template Task the
 * cutover moved (same owner, workspace, and createdAt), the Task a PUT made
 * it from (created shortly before it), else the schedule id. Each match is
 * confirmed by the id derived from it.
 */
export async function legacyTaskIds(
  schedules: TaskSchedule[],
): Promise<Map<string, string>> {
  const legacyIds = new Map(
    schedules.map((schedule) => [schedule.id, schedule.id]),
  );
  if (schedules.length === 0) {
    return legacyIds;
  }
  const operations = await prisma.taskScheduleCreateOperation.findMany({
    where: { scheduleId: { in: schedules.map((schedule) => schedule.id) } },
    select: { scheduleId: true, operationId: true },
  });
  const scheduleByOperation = new Map(
    operations.map((operation) => [
      operation.operationId,
      operation.scheduleId,
    ]),
  );
  const candidates = await prisma.task.findMany({
    where: {
      OR: schedules.map((schedule) => ({
        workspaceId: schedule.workspaceId,
        ownerId: schedule.ownerId,
        createdAt: {
          gte: new Date(
            schedule.createdAt.getTime() - SHIM_BLUEPRINT_WINDOW_MS,
          ),
          lte: schedule.createdAt,
        },
      })),
    },
    select: { id: true },
  });
  for (const { id } of candidates) {
    const migrated = migratedTaskScheduleId(id);
    if (legacyIds.has(migrated)) {
      legacyIds.set(migrated, id);
    }
    const shimmed = scheduleByOperation.get(shimCreateOperationId(id));
    if (shimmed) {
      legacyIds.set(shimmed, id);
    }
  }
  return legacyIds;
}
