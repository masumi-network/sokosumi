import {
  CalendarSourceAccuracy,
  CalendarSourceType,
  CalendarTimeAccuracy,
  type Prisma,
  TaskScheduleOccurrenceState,
  TaskStatus,
} from "@sokosumi/database";
import type { TaskScheduleMetadata } from "@sokosumi/utils";

import { iterateTaskScheduleOccurrences } from "@/helpers/task-schedule";
import { quarantineTaskSchedule } from "@/helpers/task-schedule-quarantine";
import { validatePersistedTaskSchedule } from "@/helpers/task-schedule-validation";

export const CALENDAR_OCCURRENCE_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES = 2_000;

export class TaskScheduleOccurrenceLimitError extends Error {
  constructor() {
    super(
      `Schedule creates too many occurrences in the next 90 days (maximum ${MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES})`,
    );
    this.name = "TaskScheduleOccurrenceLimitError";
  }
}

export interface TaskScheduleOccurrenceIndexTask {
  id: string;
  workspaceId: string;
  projectId: string | null;
  schedule: TaskScheduleMetadata;
  nextRunAt: Date;
}

export interface TaskScheduleOccurrenceIndexCandidate {
  id: string;
  workspaceId: string;
  projectId: string | null;
  status: TaskStatus;
  metadata: string | null;
  nextRunAt: Date | null;
}

interface TaskScheduleOccurrenceDeleteClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "deleteMany"
  >;
}

interface TaskScheduleOccurrenceCreateClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "createMany"
  >;
}

interface TaskScheduleOccurrenceIndexClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "createMany" | "deleteMany"
  >;
}

interface TaskScheduleOccurrenceRetireClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "findMany" | "updateMany" | "deleteMany"
  >;
}

interface TaskScheduleOccurrenceReadClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "findMany"
  >;
}

interface TaskScheduleOccurrenceRefreshClient
  extends TaskScheduleOccurrenceIndexClient {
  taskScheduleQuarantine: Pick<
    Prisma.TransactionClient["taskScheduleQuarantine"],
    "upsert"
  >;
}

function getOccurrenceSource(task: TaskScheduleOccurrenceIndexTask) {
  return {
    sourceWorkspaceId: task.workspaceId,
    sourceType: task.projectId
      ? CalendarSourceType.PROJECT
      : CalendarSourceType.WORKSPACE,
    sourceProjectId: task.projectId,
    sourceAccuracy: CalendarSourceAccuracy.EXACT,
    timeAccuracy: CalendarTimeAccuracy.EXACT,
  };
}

export async function removeTaskSchedulePlannedOccurrences(
  tx: TaskScheduleOccurrenceDeleteClient,
  seriesTaskId: string,
): Promise<void> {
  await tx.taskScheduleOccurrence.deleteMany({
    where: {
      seriesTaskId,
      state: TaskScheduleOccurrenceState.PLANNED,
    },
  });
}

function projectPlannedOccurrenceRows(
  task: TaskScheduleOccurrenceIndexTask,
  now: Date,
) {
  const horizonEnd = new Date(now.getTime() + CALENDAR_OCCURRENCE_HORIZON_MS);
  const occurrences = Array.from(
    iterateTaskScheduleOccurrences(
      task.id,
      task.schedule,
      task.nextRunAt,
      now,
      horizonEnd,
      MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES + 1,
    ),
  );
  if (occurrences.length > MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES) {
    throw new TaskScheduleOccurrenceLimitError();
  }

  const source = getOccurrenceSource(task);
  return occurrences.map((occurrence) => ({
    seriesTaskId: task.id,
    epochId: task.schedule.version === 2 ? task.schedule.epochId : null,
    originalScheduledAt: occurrence.originalScheduledAt,
    effectiveScheduledAt: occurrence.scheduledAt,
    state: TaskScheduleOccurrenceState.PLANNED,
    scheduleVersion: task.schedule.version,
    ...source,
    timezone:
      task.schedule.version === 2 || task.schedule.mode === "recurring"
        ? task.schedule.timezone
        : null,
    ruleSnapshot: task.schedule,
  }));
}

/**
 * Adds the rolling-horizon projection for a schedule epoch without touching
 * rows that already exist. Series edits pair this with
 * {@link retireTaskScheduleFutureOccurrences} so past and released history
 * survives the rule change.
 */
export async function createTaskSchedulePlannedOccurrences(
  tx: TaskScheduleOccurrenceCreateClient,
  task: TaskScheduleOccurrenceIndexTask,
  now = new Date(),
): Promise<void> {
  const rows = projectPlannedOccurrenceRows(task, now);
  if (rows.length === 0) {
    return;
  }

  await tx.taskScheduleOccurrence.createMany({ data: rows });
}

export async function replaceTaskSchedulePlannedOccurrences(
  tx: TaskScheduleOccurrenceIndexClient,
  task: TaskScheduleOccurrenceIndexTask,
  now = new Date(),
): Promise<void> {
  const rows = projectPlannedOccurrenceRows(task, now);

  await removeTaskSchedulePlannedOccurrences(tx, task.id);
  if (rows.length === 0) {
    return;
  }

  await tx.taskScheduleOccurrence.createMany({ data: rows });
}

export interface RetiredTaskScheduleOccurrences {
  canceledCount: number;
}

function isDurableScheduleException(occurrence: {
  state: TaskScheduleOccurrenceState;
  scheduleVersion: number;
  originalScheduledAt: Date | null;
  effectiveScheduledAt: Date;
}): boolean {
  // A legacy row carries no epoch and the identity check constraint requires
  // `state = 'PLANNED'` for it, so it can only ever be deleted.
  if (occurrence.scheduleVersion === 1) {
    return false;
  }

  return (
    occurrence.state === TaskScheduleOccurrenceState.SKIPPED ||
    (occurrence.originalScheduledAt != null &&
      occurrence.originalScheduledAt.getTime() !==
        occurrence.effectiveScheduledAt.getTime())
  );
}

function futureScheduleOccurrenceCandidatesWhere(
  seriesTaskId: string,
  now: Date,
): Prisma.TaskScheduleOccurrenceWhereInput {
  return {
    seriesTaskId,
    effectiveScheduledAt: { gte: now },
    state: {
      in: [
        TaskScheduleOccurrenceState.PLANNED,
        TaskScheduleOccurrenceState.SKIPPED,
      ],
    },
  };
}

/**
 * Retires the future half of a series ledger when its rule is replaced or the
 * series is removed.
 *
 * A durable exception — a skipped occurrence, or a planned one a human moved
 * away from its original time — becomes `CANCELED` so the decision stays
 * visible in history. Ordinary future projections carry no decision and are
 * deleted. Released occurrences and everything already in the past are never
 * touched.
 *
 * The candidate read is unbounded on purpose: every series edit and removal
 * retires the whole future half before projecting again, so at most one live
 * epoch's projection is ever in this set, and that projection is capped at
 * {@link MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES} rows inside the
 * {@link CALENDAR_OCCURRENCE_HORIZON_MS} horizon. A `take` here would silently
 * strand rows instead of retiring them if that invariant ever broke.
 */
export async function retireTaskScheduleFutureOccurrences(
  tx: TaskScheduleOccurrenceRetireClient,
  seriesTaskId: string,
  now = new Date(),
): Promise<RetiredTaskScheduleOccurrences> {
  const futureOccurrences = await tx.taskScheduleOccurrence.findMany({
    where: futureScheduleOccurrenceCandidatesWhere(seriesTaskId, now),
    select: {
      id: true,
      state: true,
      scheduleVersion: true,
      originalScheduledAt: true,
      effectiveScheduledAt: true,
    },
  });

  const canceledIds: string[] = [];
  const deletedIds: string[] = [];
  for (const occurrence of futureOccurrences) {
    if (isDurableScheduleException(occurrence)) {
      canceledIds.push(occurrence.id);
    } else {
      deletedIds.push(occurrence.id);
    }
  }

  if (canceledIds.length > 0) {
    await tx.taskScheduleOccurrence.updateMany({
      where: { id: { in: canceledIds } },
      data: { state: TaskScheduleOccurrenceState.CANCELED },
    });
  }
  if (deletedIds.length > 0) {
    await tx.taskScheduleOccurrence.deleteMany({
      where: { id: { in: deletedIds } },
    });
  }

  return { canceledCount: canceledIds.length };
}

/**
 * How many durable exceptions a full-series edit or removal would cancel right
 * now.
 *
 * It reads the same bounded future candidate set as
 * {@link retireTaskScheduleFutureOccurrences} and applies the same predicate,
 * so the number a confirmation dialog shows is exactly the number the mutation
 * would retire — a `count` with its own hand-written predicate could drift
 * from the retirement rule.
 */
export async function countTaskScheduleFutureExceptions(
  tx: TaskScheduleOccurrenceReadClient,
  seriesTaskId: string,
  now = new Date(),
): Promise<number> {
  const futureOccurrences = await tx.taskScheduleOccurrence.findMany({
    where: futureScheduleOccurrenceCandidatesWhere(seriesTaskId, now),
    select: {
      state: true,
      scheduleVersion: true,
      originalScheduledAt: true,
      effectiveScheduledAt: true,
    },
  });

  return futureOccurrences.filter(isDurableScheduleException).length;
}

export async function refreshTaskSchedulePlannedOccurrences(
  tx: TaskScheduleOccurrenceRefreshClient,
  task: TaskScheduleOccurrenceIndexCandidate,
): Promise<void> {
  if (task.metadata === null && task.nextRunAt === null) {
    await removeTaskSchedulePlannedOccurrences(tx, task.id);
    return;
  }

  const validation = validatePersistedTaskSchedule(task);
  if (!validation.valid) {
    await quarantineTaskSchedule(
      tx,
      task,
      validation.reason,
      validation.details,
    );
    return;
  }
  if (!task.nextRunAt) {
    return;
  }

  try {
    await replaceTaskSchedulePlannedOccurrences(tx, {
      id: task.id,
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      schedule: validation.metadata,
      nextRunAt: task.nextRunAt,
    });
  } catch (error) {
    if (!(error instanceof TaskScheduleOccurrenceLimitError)) {
      throw error;
    }
    await removeTaskSchedulePlannedOccurrences(tx, task.id);
  }
}
