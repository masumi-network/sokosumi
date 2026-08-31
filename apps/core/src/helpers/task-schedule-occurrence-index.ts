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

interface TaskScheduleOccurrenceIndexClient
  extends TaskScheduleOccurrenceDeleteClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "createMany" | "deleteMany"
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

export async function replaceTaskSchedulePlannedOccurrences(
  tx: TaskScheduleOccurrenceIndexClient,
  task: TaskScheduleOccurrenceIndexTask,
  now = new Date(),
): Promise<void> {
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

  await removeTaskSchedulePlannedOccurrences(tx, task.id);
  if (occurrences.length === 0) {
    return;
  }

  const source = getOccurrenceSource(task);
  await tx.taskScheduleOccurrence.createMany({
    data: occurrences.map((occurrence) => ({
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
    })),
  });
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
