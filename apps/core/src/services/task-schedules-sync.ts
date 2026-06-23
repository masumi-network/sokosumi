import { type Prisma, TaskEventOrigin, TaskLinkType } from "@sokosumi/database";
import type { TaskScheduleMetadata } from "@sokosumi/database/types/task-schedule-metadata";
import { TaskStatus } from "@sokosumi/utils";

import { computeNextRun } from "@/helpers/cron";
import {
  isRecurringScheduleEnded,
  parseTaskScheduleMetadata,
} from "@/helpers/task-schedule";
import prisma from "@/lib/db/prisma";

const TASK_SCHEDULE_SYNC_BATCH_SIZE = 25;

export interface TaskScheduleSyncExecutionOptions {
  abortSignal: AbortSignal;
  deadlineMs: number;
  shouldContinue: () => boolean;
}

export interface TaskScheduleSyncResult {
  promoted: number;
  cloned: number;
  durationMs: number;
}

function getCloneTaskData(
  template: Prisma.TaskGetPayload<{
    select: {
      userId: true;
      organizationId: true;
      workspaceId: true;
      projectId: true;
      coworkerId: true;
      name: true;
      description: true;
    };
  }>,
) {
  return {
    userId: template.userId,
    organizationId: template.organizationId,
    workspaceId: template.workspaceId,
    projectId: template.projectId,
    coworkerId: template.coworkerId,
    name: template.name,
    description: template.description,
    status: TaskStatus.READY,
    events: {
      create: {
        status: TaskStatus.READY,
        origin: TaskEventOrigin.SOKOSUMI,
        userId: template.userId,
      },
    },
  };
}

function clearTemplateSchedule(
  tx: Prisma.TransactionClient,
  templateId: string,
): Promise<unknown> {
  return tx.task.update({
    where: { id: templateId },
    data: {
      status: TaskStatus.DRAFT,
      metadata: null,
      nextRunAt: null,
    },
  });
}

async function promoteOneTimeTask(
  tx: Prisma.TransactionClient,
  templateId: string,
  userId: string,
): Promise<void> {
  await tx.task.update({
    where: { id: templateId },
    data: {
      status: TaskStatus.READY,
      metadata: null,
      nextRunAt: null,
    },
  });

  await tx.taskEvent.create({
    data: {
      taskId: templateId,
      status: TaskStatus.READY,
      origin: TaskEventOrigin.SOKOSUMI,
      userId,
    },
  });
}

function getUpdatedRecurringMetadata(
  metadata: Extract<TaskScheduleMetadata, { mode: "recurring" }>,
  lastRunAt: Date,
): Extract<TaskScheduleMetadata, { mode: "recurring" }> {
  if (metadata.endsMode !== "after" || metadata.occurrences == null) {
    return {
      ...metadata,
      lastRunAt: lastRunAt.toISOString(),
    };
  }

  return {
    ...metadata,
    lastRunAt: lastRunAt.toISOString(),
    occurrences: metadata.occurrences - 1,
  };
}

function shouldEndRecurringAfterRun(
  metadata: Extract<TaskScheduleMetadata, { mode: "recurring" }>,
  nextRunAt: Date | null,
): boolean {
  if (metadata.endsMode === "after") {
    return metadata.occurrences != null && metadata.occurrences <= 0;
  }

  if (metadata.endsMode === "on" && metadata.endsOn) {
    if (!nextRunAt) {
      return true;
    }

    return nextRunAt > new Date(metadata.endsOn);
  }

  return nextRunAt == null;
}

async function processDueTask(
  templateId: string,
): Promise<"promoted" | "cloned" | "skipped"> {
  return prisma.$transaction(async (tx) => {
    const template = await tx.task.findFirst({
      where: {
        id: templateId,
        status: TaskStatus.QUEUED,
        archivedAt: null,
        nextRunAt: { lte: new Date() },
      },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        workspaceId: true,
        projectId: true,
        coworkerId: true,
        name: true,
        description: true,
        metadata: true,
      },
    });

    if (!template) {
      return "skipped";
    }

    const scheduleMetadata = parseTaskScheduleMetadata(template.metadata);
    if (!scheduleMetadata) {
      await clearTemplateSchedule(tx, template.id);
      return "skipped";
    }

    if (scheduleMetadata.mode === "once") {
      await promoteOneTimeTask(tx, template.id, template.userId);
      return "promoted";
    }

    const now = new Date();
    if (isRecurringScheduleEnded(scheduleMetadata, now)) {
      await clearTemplateSchedule(tx, template.id);
      return "skipped";
    }

    const clone = await tx.task.create({
      data: getCloneTaskData(template),
      select: { id: true },
    });

    await tx.taskLink.create({
      data: {
        fromTaskId: template.id,
        toTaskId: clone.id,
        type: TaskLinkType.PARENT,
      },
    });

    const updatedMetadata = getUpdatedRecurringMetadata(scheduleMetadata, now);
    const nextRunAt = computeNextRun({
      cron: scheduleMetadata.expr,
      timezone: scheduleMetadata.timezone,
      from: now,
    });

    if (shouldEndRecurringAfterRun(updatedMetadata, nextRunAt)) {
      await clearTemplateSchedule(tx, template.id);
      return "cloned";
    }

    await tx.task.update({
      where: { id: template.id },
      data: {
        metadata: JSON.stringify(updatedMetadata),
        nextRunAt,
      },
    });

    return "cloned";
  });
}

async function syncDueTaskSchedules(
  options: TaskScheduleSyncExecutionOptions,
): Promise<Pick<TaskScheduleSyncResult, "promoted" | "cloned">> {
  let promoted = 0;
  let cloned = 0;

  while (options.shouldContinue()) {
    const dueTasks = await prisma.task.findMany({
      where: {
        status: TaskStatus.QUEUED,
        archivedAt: null,
        nextRunAt: { lte: new Date() },
      },
      orderBy: [{ nextRunAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: TASK_SCHEDULE_SYNC_BATCH_SIZE,
      select: { id: true },
    });

    if (dueTasks.length === 0) {
      break;
    }

    for (const dueTask of dueTasks) {
      if (!options.shouldContinue()) {
        break;
      }

      const result = await processDueTask(dueTask.id);
      if (result === "promoted") {
        promoted += 1;
      } else if (result === "cloned") {
        cloned += 1;
      }
    }

    if (dueTasks.length < TASK_SCHEDULE_SYNC_BATCH_SIZE) {
      break;
    }
  }

  return { promoted, cloned };
}

export const taskSchedulesSyncService = {
  async syncDueSchedules(
    options: TaskScheduleSyncExecutionOptions,
  ): Promise<TaskScheduleSyncResult> {
    const startedAt = Date.now();
    const { promoted, cloned } = await syncDueTaskSchedules(options);

    return {
      promoted,
      cloned,
      durationMs: Date.now() - startedAt,
    };
  },
};
