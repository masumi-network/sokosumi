import * as Sentry from "@sentry/node";
import {
  Channel,
  type Prisma,
  TaskLinkType,
  TaskStatus,
} from "@sokosumi/database";
import type { TaskScheduleMetadata } from "@sokosumi/database/types/task-schedule-metadata";

import {
  computeScheduleNextRun,
  isDueRunPastScheduleEnd,
  parseTaskScheduleMetadata,
} from "@/helpers/task-schedule";
import { publishTaskEventData } from "@/lib/ably/publish";
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

interface TaskStatusPublishEvent {
  userId: string;
  taskId: string;
}

interface ProcessDueTaskResult {
  outcome: "promoted" | "cloned" | "skipped";
  publishEvents: TaskStatusPublishEvent[];
}

async function publishTaskStatusUpdates(
  publishEvents: TaskStatusPublishEvent[],
): Promise<void> {
  await Promise.all(
    publishEvents.map(async ({ userId, taskId }) => {
      try {
        await publishTaskEventData({
          userId,
          taskId,
          eventType: "task_event",
        });
      } catch (error) {
        Sentry.captureException(error, {
          tags: {
            error_type: "publish_task_event",
          },
          extra: {
            taskId,
            userId,
            source: "task-schedules-sync",
          },
        });
      }
    }),
  );
}

function getCloneTaskData(
  template: Prisma.TaskGetPayload<{
    select: {
      ownerId: true;
      organizationId: true;
      workspaceId: true;
      projectId: true;
      assigneeId: true;
      name: true;
      description: true;
    };
  }>,
) {
  return {
    ownerId: template.ownerId,
    organizationId: template.organizationId,
    workspaceId: template.workspaceId,
    projectId: template.projectId,
    assigneeId: template.assigneeId,
    name: template.name,
    description: template.description,
    status: TaskStatus.READY,
    metadata: null,
    nextRunAt: null,
    creatorUserId: template.ownerId,
    creatorCoworkerId: null,
    creatorOrchestratorId: null,
    events: {
      create: {
        status: TaskStatus.READY,
        channel: Channel.SOKOSUMI,
        userId: template.ownerId,
      },
    },
  };
}

/**
 * Claim guard for schedule sync writes: status must still be QUEUED and
 * `nextRunAt` must still equal the value read at transaction start. A concurrent
 * schedule PUT / clear / cancel that changes `nextRunAt` (or leaves QUEUED)
 * must not be overwritten — otherwise sync can wipe a fresh schedule to DRAFT
 * or re-arm an obsolete cadence after cloning from superseded metadata.
 */
function queuedTemplateClaimWhere(templateId: string, claimedNextRunAt: Date) {
  return {
    id: templateId,
    status: TaskStatus.QUEUED,
    nextRunAt: claimedNextRunAt,
  };
}

async function clearTemplateSchedule(
  tx: Prisma.TransactionClient,
  templateId: string,
  claimedNextRunAt: Date,
): Promise<boolean> {
  const updateResult = await tx.task.updateMany({
    where: queuedTemplateClaimWhere(templateId, claimedNextRunAt),
    data: {
      status: TaskStatus.DRAFT,
      metadata: null,
      nextRunAt: null,
    },
  });

  return updateResult.count === 1;
}

async function promoteOneTimeTask(
  tx: Prisma.TransactionClient,
  templateId: string,
  userId: string,
  claimedNextRunAt: Date,
): Promise<boolean> {
  const updateResult = await tx.task.updateMany({
    where: queuedTemplateClaimWhere(templateId, claimedNextRunAt),
    data: {
      status: TaskStatus.READY,
      metadata: null,
      nextRunAt: null,
    },
  });
  if (updateResult.count !== 1) {
    return false;
  }

  await tx.taskEvent.create({
    data: {
      taskId: templateId,
      status: TaskStatus.READY,
      channel: Channel.SOKOSUMI,
      userId,
    },
  });

  return true;
}

async function isTemplateClaimStillHeld(
  tx: Prisma.TransactionClient,
  templateId: string,
  claimedNextRunAt: Date,
): Promise<boolean> {
  const template = await tx.task.findFirst({
    where: queuedTemplateClaimWhere(templateId, claimedNextRunAt),
    select: { id: true },
  });

  return template != null;
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

async function cloneRecurringOccurrence(
  tx: Prisma.TransactionClient,
  template: Prisma.TaskGetPayload<{
    select: {
      id: true;
      ownerId: true;
      organizationId: true;
      workspaceId: true;
      projectId: true;
      assigneeId: true;
      name: true;
      description: true;
    };
  }>,
): Promise<string> {
  const clone = await tx.task.create({
    data: getCloneTaskData(template),
    select: { id: true },
  });

  await tx.taskLink.create({
    data: {
      fromTaskId: template.id,
      toTaskId: clone.id,
      type: TaskLinkType.SCHEDULE,
    },
  });

  return clone.id;
}

/**
 * Thrown inside the processDueTask transaction when clones were created but
 * the template is no longer QUEUED (e.g. canceled mid-sync). Prisma rolls
 * back the transaction so READY clones are not committed.
 */
class TemplateClaimLostError extends Error {
  constructor() {
    super("Task schedule template is no longer QUEUED");
    this.name = "TemplateClaimLostError";
  }
}

function assertTemplateClaimHeld(
  claimed: boolean,
  clonesCreated: number,
): void {
  if (!claimed && clonesCreated > 0) {
    throw new TemplateClaimLostError();
  }
}

async function processDueTask(
  templateId: string,
  options: TaskScheduleSyncExecutionOptions,
): Promise<ProcessDueTaskResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const template = await tx.task.findFirst({
        where: {
          id: templateId,
          status: TaskStatus.QUEUED,
          archivedAt: null,
          pendingVendorGrantId: null,
          nextRunAt: { lte: new Date() },
        },
        select: {
          id: true,
          ownerId: true,
          organizationId: true,
          workspaceId: true,
          projectId: true,
          assigneeId: true,
          name: true,
          description: true,
          metadata: true,
          nextRunAt: true,
        },
      });

      if (!template || !template.nextRunAt) {
        return { outcome: "skipped", publishEvents: [] };
      }

      const claimedNextRunAt = template.nextRunAt;

      const scheduleMetadata = parseTaskScheduleMetadata(template.metadata);
      if (!scheduleMetadata) {
        const cleared = await clearTemplateSchedule(
          tx,
          template.id,
          claimedNextRunAt,
        );
        return {
          outcome: "skipped",
          publishEvents: cleared
            ? [{ userId: template.ownerId, taskId: template.id }]
            : [],
        };
      }

      if (scheduleMetadata.mode === "once") {
        const promoted = await promoteOneTimeTask(
          tx,
          template.id,
          template.ownerId,
          claimedNextRunAt,
        );
        if (!promoted) {
          return { outcome: "skipped", publishEvents: [] };
        }
        return {
          outcome: "promoted",
          publishEvents: [{ userId: template.ownerId, taskId: template.id }],
        };
      }

      const now = new Date();
      let metadata = scheduleMetadata;
      let nextRunAt = claimedNextRunAt;
      let clonesCreated = 0;
      const clonedTaskIds: string[] = [];

      while (nextRunAt && nextRunAt <= now) {
        if (
          !options.shouldContinue() ||
          options.abortSignal.aborted ||
          Date.now() >= options.deadlineMs
        ) {
          break;
        }

        if (isDueRunPastScheduleEnd(metadata, nextRunAt)) {
          break;
        }

        if (
          !(await isTemplateClaimStillHeld(tx, template.id, claimedNextRunAt))
        ) {
          break;
        }

        const cloneId = await cloneRecurringOccurrence(tx, template);
        clonedTaskIds.push(cloneId);
        clonesCreated += 1;

        metadata = getUpdatedRecurringMetadata(metadata, nextRunAt);
        const computedNextRun = computeScheduleNextRun(metadata, nextRunAt);

        if (shouldEndRecurringAfterRun(metadata, computedNextRun)) {
          const cleared = await clearTemplateSchedule(
            tx,
            template.id,
            claimedNextRunAt,
          );
          assertTemplateClaimHeld(cleared, clonesCreated);
          return {
            outcome: "cloned",
            publishEvents: buildRecurringPublishEvents(
              template.ownerId,
              template.id,
              clonedTaskIds,
              true,
            ),
          };
        }

        if (!computedNextRun) {
          const cleared = await clearTemplateSchedule(
            tx,
            template.id,
            claimedNextRunAt,
          );
          assertTemplateClaimHeld(cleared, clonesCreated);
          return {
            outcome: "cloned",
            publishEvents: buildRecurringPublishEvents(
              template.ownerId,
              template.id,
              clonedTaskIds,
              true,
            ),
          };
        }

        nextRunAt = computedNextRun;
      }

      if (clonesCreated === 0) {
        if (isDueRunPastScheduleEnd(metadata, claimedNextRunAt)) {
          const cleared = await clearTemplateSchedule(
            tx,
            template.id,
            claimedNextRunAt,
          );
          return {
            outcome: "skipped",
            publishEvents: cleared
              ? [{ userId: template.ownerId, taskId: template.id }]
              : [],
          };
        }
        return { outcome: "skipped", publishEvents: [] };
      }

      const updateResult = await tx.task.updateMany({
        where: queuedTemplateClaimWhere(template.id, claimedNextRunAt),
        data: {
          metadata: JSON.stringify(metadata),
          nextRunAt,
        },
      });
      assertTemplateClaimHeld(updateResult.count === 1, clonesCreated);

      return {
        outcome: "cloned",
        publishEvents: buildRecurringPublishEvents(
          template.ownerId,
          template.id,
          clonedTaskIds,
          false,
        ),
      };
    });
  } catch (error) {
    if (error instanceof TemplateClaimLostError) {
      return { outcome: "skipped", publishEvents: [] };
    }
    throw error;
  }
}

function buildRecurringPublishEvents(
  userId: string,
  templateId: string,
  clonedTaskIds: string[],
  includeTemplate: boolean,
): TaskStatusPublishEvent[] {
  const publishEvents = clonedTaskIds.map((taskId) => ({ userId, taskId }));

  if (includeTemplate) {
    publishEvents.push({ userId, taskId: templateId });
  }

  return publishEvents;
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
        pendingVendorGrantId: null,
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

      const result = await processDueTask(dueTask.id, options);
      if (result.publishEvents.length > 0) {
        await publishTaskStatusUpdates(result.publishEvents);
      }
      if (result.outcome === "promoted") {
        promoted += 1;
      } else if (result.outcome === "cloned") {
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
