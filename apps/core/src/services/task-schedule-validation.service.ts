import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import {
  removeTaskSchedulePlannedOccurrences,
  replaceTaskSchedulePlannedOccurrences,
  TaskScheduleOccurrenceLimitError,
} from "@/helpers/task-schedule-occurrence-index";
import { quarantineTaskSchedule } from "@/helpers/task-schedule-quarantine";
import { validatePersistedTaskSchedule } from "@/helpers/task-schedule-validation";
import prisma from "@/lib/db/prisma";

const VALIDATION_BATCH_SIZE = 25;
const VALIDATION_CURSOR_KEY = "task-schedule-validation:cursor";

export interface TaskScheduleValidationExecutionOptions {
  shouldContinue: () => boolean;
}

export interface TaskScheduleValidationResult {
  scanned: number;
  quarantined: number;
  passComplete: boolean;
}

async function validateTask(taskId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        status: true,
        metadata: true,
        nextRunAt: true,
        archivedAt: true,
        scheduleQuarantine: { select: { id: true } },
      },
    });
    if (!candidate || candidate.archivedAt || candidate.scheduleQuarantine) {
      return false;
    }

    const scopeLocked = await lockCalendarScope(tx, candidate.workspaceId, [
      candidate.projectId,
    ]);
    if (!scopeLocked || !(await lockTaskRows(tx, [candidate.id]))) {
      return false;
    }

    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        status: true,
        metadata: true,
        nextRunAt: true,
        archivedAt: true,
        scheduleQuarantine: { select: { id: true } },
      },
    });
    if (
      !task ||
      task.archivedAt ||
      task.scheduleQuarantine ||
      task.workspaceId !== candidate.workspaceId ||
      task.projectId !== candidate.projectId
    ) {
      return false;
    }

    const validation = validatePersistedTaskSchedule(task);
    if (!validation.valid) {
      await quarantineTaskSchedule(
        tx,
        task,
        validation.reason,
        validation.details,
      );
      return true;
    }

    if (!task.nextRunAt) {
      return false;
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
    return false;
  });
}

export const taskScheduleValidationService = {
  async validateActiveSchedules(
    options: TaskScheduleValidationExecutionOptions,
  ): Promise<TaskScheduleValidationResult> {
    const cursor = await prisma.syncMetadata.findUnique({
      where: { key: VALIDATION_CURSOR_KEY },
      select: { cursorId: true },
    });
    const tasks = await prisma.task.findMany({
      where: {
        archivedAt: null,
        scheduleQuarantine: null,
        owner: {
          email: { endsWith: "@nmkr.io", mode: "insensitive" },
        },
        OR: [{ metadata: { not: null } }, { nextRunAt: { not: null } }],
        ...(cursor?.cursorId ? { id: { gt: cursor.cursorId } } : {}),
      },
      orderBy: { id: "asc" },
      take: VALIDATION_BATCH_SIZE,
      select: { id: true },
    });

    let scanned = 0;
    let quarantined = 0;
    for (const task of tasks) {
      if (!options.shouldContinue()) {
        break;
      }
      scanned += 1;
      if (await validateTask(task.id)) {
        quarantined += 1;
      }
    }

    const lastTask = tasks[scanned - 1];
    if (lastTask || tasks.length === 0) {
      await prisma.syncMetadata.upsert({
        where: { key: VALIDATION_CURSOR_KEY },
        create: {
          key: VALIDATION_CURSOR_KEY,
          lastSyncedAt: new Date(),
          cursorId: lastTask?.id ?? null,
        },
        update: {
          lastSyncedAt: new Date(),
          cursorId: lastTask?.id ?? null,
        },
      });
    }

    return {
      scanned,
      quarantined,
      passComplete:
        scanned === tasks.length && tasks.length < VALIDATION_BATCH_SIZE,
    };
  },
};
