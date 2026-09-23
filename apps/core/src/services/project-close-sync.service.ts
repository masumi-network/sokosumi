import { randomUUID } from "node:crypto";

import {
  Channel,
  Prisma,
  ProjectCloseOperationState,
  TaskScheduleOccurrenceState,
  TaskStatus,
} from "@sokosumi/database";
import { parseTaskScheduleMetadata } from "@sokosumi/utils";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import {
  notifyProjectCloseTransition,
  retryMissingProjectCloseNotifications,
} from "@/helpers/project-close-notifications";
import { isSchedulableTaskStatus } from "@/helpers/task-schedule";
import { retireTaskScheduleFutureOccurrences } from "@/helpers/task-schedule-occurrence-index";
import {
  cloneRecurringTaskScheduleOccurrence,
  type TaskScheduleReleaseTemplate,
} from "@/helpers/task-schedule-release";
import prisma from "@/lib/db/prisma";

const PROJECT_CLOSE_OPERATION_BATCH_SIZE = 5;
const PROJECT_CLOSE_SERIES_BATCH_SIZE = 10;
const PROJECT_CLOSE_OCCURRENCE_BATCH_SIZE = 25;
const PROJECT_CLOSE_LEASE_MS = 5 * 60 * 1000;
const PROJECT_CLOSE_MAX_FAILURES = 3;
const PROJECT_CLOSE_RETRY_BASE_MS = 30_000;

export interface ProjectCloseSyncExecutionOptions {
  abortSignal: AbortSignal;
  deadlineMs: number;
  shouldContinue: () => boolean;
}

export interface ProjectCloseSyncResult {
  claimed: number;
  processedSeries: number;
  closed: number;
  failed: number;
}

interface ClaimedProjectClose {
  id: string;
  leaseToken: string;
}

interface ProcessProjectCloseResult {
  processedSeries: number;
  closed: boolean;
}

class ProjectCloseSeriesError extends Error {
  constructor(
    readonly seriesTaskId: string,
    cause: unknown,
  ) {
    super("Scheduled work could not be closed", { cause });
    this.name = "ProjectCloseSeriesError";
  }
}

async function updateOwnedProjectClose(
  tx: Prisma.TransactionClient,
  claimed: ClaimedProjectClose,
  data: Prisma.ProjectCloseOperationUpdateManyMutationInput,
): Promise<void> {
  const updated = await tx.projectCloseOperation.updateMany({
    where: {
      id: claimed.id,
      state: ProjectCloseOperationState.CLOSING,
      leaseToken: claimed.leaseToken,
    },
    data,
  });
  if (updated.count !== 1) {
    throw new Error("Project close lease was lost");
  }
}

function activeProjectScheduleWhere(
  projectId: string,
  cursor?: string | null,
): Prisma.TaskWhereInput {
  return {
    projectId,
    archivedAt: null,
    ...(cursor ? { id: { gt: cursor } } : {}),
    OR: [
      { metadata: { not: null } },
      { nextRunAt: { not: null } },
      { scheduleQuarantine: { isNot: null } },
    ],
  };
}

function nextRetryAt(attempts: number, now: Date): Date {
  return new Date(
    now.getTime() +
      PROJECT_CLOSE_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1),
  );
}

async function claimProjectCloses(now: Date): Promise<ClaimedProjectClose[]> {
  const leaseExpiredBefore = new Date(now.getTime() - PROJECT_CLOSE_LEASE_MS);
  const candidates = await prisma.projectCloseOperation.findMany({
    where: {
      state: ProjectCloseOperationState.CLOSING,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [
        {
          OR: [
            { leaseToken: null },
            { leasedAt: null },
            { leasedAt: { lte: leaseExpiredBefore } },
          ],
        },
      ],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: PROJECT_CLOSE_OPERATION_BATCH_SIZE,
    select: { id: true },
  });

  const claimed: ClaimedProjectClose[] = [];
  for (const candidate of candidates) {
    const leaseToken = randomUUID();
    const updated = await prisma.projectCloseOperation.updateMany({
      where: {
        id: candidate.id,
        state: ProjectCloseOperationState.CLOSING,
        AND: [
          {
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            OR: [
              { leaseToken: null },
              { leasedAt: null },
              { leasedAt: { lte: leaseExpiredBefore } },
            ],
          },
        ],
      },
      data: { leaseToken, leasedAt: now },
    });
    if (updated.count === 1) claimed.push({ id: candidate.id, leaseToken });
  }
  return claimed;
}

async function releaseRecurringOwedBatch(
  tx: Prisma.TransactionClient,
  task: TaskScheduleReleaseTemplate & { metadata: string | null },
  cutoffAt: Date,
): Promise<boolean> {
  const owed = await tx.taskScheduleOccurrence.findMany({
    where: {
      seriesTaskId: task.id,
      sourceProjectId: task.projectId,
      state: TaskScheduleOccurrenceState.PLANNED,
      effectiveScheduledAt: { lt: cutoffAt },
    },
    orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
    take: PROJECT_CLOSE_OCCURRENCE_BATCH_SIZE,
    select: {
      id: true,
      epochId: true,
      scheduleVersion: true,
      originalScheduledAt: true,
      effectiveScheduledAt: true,
      ruleSnapshot: true,
    },
  });

  const currentMetadata = parseTaskScheduleMetadata(task.metadata);
  for (const occurrence of owed) {
    const occurrenceMetadata = parseTaskScheduleMetadata(
      occurrence.ruleSnapshot
        ? JSON.stringify(occurrence.ruleSnapshot)
        : undefined,
    );
    if (
      !occurrenceMetadata ||
      occurrenceMetadata.mode !== "recurring" ||
      (occurrence.scheduleVersion === 2 &&
        (occurrenceMetadata.version !== 2 ||
          occurrenceMetadata.epochId !== occurrence.epochId))
    ) {
      throw new Error("Occurrence schedule snapshot is invalid");
    }
    // Legacy releases used separate history rows and left their projections
    // behind. A saved cursor also proves release when history was disabled.
    const alreadyReleased =
      occurrence.scheduleVersion === 1 &&
      occurrenceMetadata.version === 1 &&
      ((currentMetadata?.version === 1 &&
        currentMetadata.scheduledAt === occurrenceMetadata.scheduledAt &&
        currentMetadata.lastRunAt != null &&
        new Date(currentMetadata.lastRunAt) >=
          occurrence.effectiveScheduledAt) ||
        (await tx.taskScheduleOccurrence.findFirst({
          where: {
            seriesTaskId: task.id,
            sourceProjectId: task.projectId,
            scheduleVersion: 1,
            state: TaskScheduleOccurrenceState.RELEASED,
            effectiveScheduledAt: occurrence.effectiveScheduledAt,
            ruleSnapshot: {
              path: ["scheduledAt"],
              equals: occurrenceMetadata.scheduledAt,
            },
          },
          select: { id: true },
        })) !== null);
    if (!alreadyReleased) {
      await cloneRecurringTaskScheduleOccurrence(
        tx,
        task,
        occurrenceMetadata,
        {
          originalScheduledAt:
            occurrence.originalScheduledAt ?? occurrence.effectiveScheduledAt,
          effectiveScheduledAt: occurrence.effectiveScheduledAt,
        },
        true,
      );
    }
    if (occurrence.scheduleVersion === 1) {
      await tx.taskScheduleOccurrence.deleteMany({
        where: {
          id: occurrence.id,
          state: TaskScheduleOccurrenceState.PLANNED,
        },
      });
    }
  }

  const remaining = await tx.taskScheduleOccurrence.findFirst({
    where: {
      seriesTaskId: task.id,
      sourceProjectId: task.projectId,
      state: TaskScheduleOccurrenceState.PLANNED,
      effectiveScheduledAt: { lt: cutoffAt },
    },
    orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
    select: { effectiveScheduledAt: true },
  });
  if (remaining) {
    await tx.task.update({
      where: { id: task.id },
      data: {
        nextRunAt: remaining.effectiveScheduledAt,
        scheduleRevision: { increment: 1 },
      },
    });
    return false;
  }

  await tx.task.update({
    where: { id: task.id },
    data: {
      status: TaskStatus.DRAFT,
      metadata: null,
      nextRunAt: null,
      scheduleRevision: { increment: 1 },
    },
  });
  return true;
}

async function resolveOneTimeSeries(
  tx: Prisma.TransactionClient,
  task: {
    id: string;
    ownerId: string;
    status: TaskStatus;
    metadata: string | null;
    projectId: string | null;
  },
  cutoffAt: Date,
): Promise<void> {
  const metadata = parseTaskScheduleMetadata(task.metadata);
  if (!metadata || metadata.mode !== "once") {
    throw new Error("One-time schedule metadata is invalid");
  }
  const owed = await tx.taskScheduleOccurrence.findFirst({
    where: {
      seriesTaskId: task.id,
      sourceProjectId: task.projectId,
      state: TaskScheduleOccurrenceState.PLANNED,
      effectiveScheduledAt: { lt: cutoffAt },
    },
    orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
    select: { id: true, scheduleVersion: true },
  });
  const released = task.status === TaskStatus.QUEUED && owed !== null;
  await tx.task.update({
    where: { id: task.id },
    data: {
      ...(released
        ? { status: TaskStatus.READY }
        : isSchedulableTaskStatus(task.status)
          ? { status: TaskStatus.DRAFT }
          : {}),
      metadata: null,
      nextRunAt: null,
      scheduleRevision: { increment: 1 },
    },
  });
  if (released && owed.scheduleVersion === 2) {
    await tx.taskScheduleOccurrence.update({
      where: { id: owed.id },
      data: {
        state: TaskScheduleOccurrenceState.RELEASED,
        releasedTaskId: task.id,
      },
    });
  } else if (owed?.scheduleVersion === 1) {
    await tx.taskScheduleOccurrence.delete({ where: { id: owed.id } });
  }
  await tx.taskScheduleOccurrence.deleteMany({
    where: {
      seriesTaskId: task.id,
      sourceProjectId: task.projectId,
      state: TaskScheduleOccurrenceState.PLANNED,
    },
  });
  if (released) {
    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        status: TaskStatus.READY,
        channel: Channel.SOKOSUMI,
        userId: task.ownerId,
      },
    });
  }
}

async function processSeries(
  tx: Prisma.TransactionClient,
  input: {
    operationId: string;
    projectId: string;
    cutoffAt: Date;
    taskId: string;
  },
): Promise<boolean> {
  if (!(await lockTaskRows(tx, [input.taskId]))) {
    return true;
  }
  const task = await tx.task.findFirst({
    where: { id: input.taskId, projectId: input.projectId },
    select: {
      id: true,
      ownerId: true,
      organizationId: true,
      workspaceId: true,
      projectId: true,
      assigneeId: true,
      name: true,
      description: true,
      visibility: true,
      status: true,
      metadata: true,
      nextRunAt: true,
      scheduleQuarantine: { select: { id: true } },
    },
  });
  if (!task) return true;

  try {
    await retireTaskScheduleFutureOccurrences(tx, task.id, input.cutoffAt, {
      sourceProjectId: input.projectId,
    });
    const metadata = parseTaskScheduleMetadata(task.metadata);
    if (task.scheduleQuarantine || !metadata || !task.nextRunAt) {
      throw new Error("Schedule requires explicit operator resolution");
    }

    let resolved = true;
    if (metadata.mode === "once") {
      await resolveOneTimeSeries(tx, task, input.cutoffAt);
    } else if (task.status === TaskStatus.QUEUED) {
      resolved = await releaseRecurringOwedBatch(tx, task, input.cutoffAt);
    } else {
      await tx.task.update({
        where: { id: task.id },
        data: {
          ...(isSchedulableTaskStatus(task.status)
            ? { status: TaskStatus.DRAFT }
            : {}),
          metadata: null,
          nextRunAt: null,
          scheduleRevision: { increment: 1 },
        },
      });
    }

    if (resolved) {
      await tx.projectEvent.create({
        data: {
          projectId: input.projectId,
          closeOperationId: input.operationId,
          eventKey: `project-close:series:${input.operationId}:${task.id}`,
          kind: "SERIES_RESOLVED",
          payload: { seriesTaskId: task.id },
        },
      });
    }
    return resolved;
  } catch (error) {
    throw new ProjectCloseSeriesError(task.id, error);
  }
}

async function finalizeProjectClose(
  tx: Prisma.TransactionClient,
  input: {
    operationId: string;
    leaseToken: string;
    projectId: string;
    cutoffAt: Date;
  },
): Promise<string | null> {
  const remaining = await tx.task.findFirst({
    where: activeProjectScheduleWhere(input.projectId),
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (remaining) {
    await updateOwnedProjectClose(
      tx,
      { id: input.operationId, leaseToken: input.leaseToken },
      { seriesCursor: null, leasedAt: new Date() },
    );
    return null;
  }

  const owed = await tx.taskScheduleOccurrence.findFirst({
    where: {
      sourceProjectId: input.projectId,
      state: TaskScheduleOccurrenceState.PLANNED,
      effectiveScheduledAt: { lt: input.cutoffAt },
      seriesTask: { status: TaskStatus.QUEUED },
    },
    orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
    select: { seriesTaskId: true },
  });
  // The series filter above only matches rows with a series Task.
  if (owed?.seriesTaskId) {
    throw new ProjectCloseSeriesError(
      owed.seriesTaskId,
      new Error("Project still has owed Calendar work"),
    );
  }

  await tx.taskScheduleOccurrence.updateMany({
    where: {
      sourceProjectId: input.projectId,
      scheduleVersion: 2,
      state: { in: ["PLANNED", "SKIPPED"] },
      effectiveScheduledAt: { gte: input.cutoffAt },
    },
    data: { state: TaskScheduleOccurrenceState.CANCELED },
  });
  await tx.taskScheduleOccurrence.deleteMany({
    where: {
      sourceProjectId: input.projectId,
      scheduleVersion: 1,
      state: TaskScheduleOccurrenceState.PLANNED,
      effectiveScheduledAt: { gte: input.cutoffAt },
    },
  });

  const completedAt = new Date();
  await tx.project.update({
    where: { id: input.projectId },
    data: {
      closedAt: completedAt,
      projectRevision: { increment: 1 },
    },
  });
  await updateOwnedProjectClose(
    tx,
    { id: input.operationId, leaseToken: input.leaseToken },
    {
      state: ProjectCloseOperationState.CLOSED,
      completedAt,
      leaseToken: null,
      leasedAt: null,
      nextAttemptAt: null,
      failureSummary: Prisma.DbNull,
    },
  );
  const event = await tx.projectEvent.create({
    data: {
      projectId: input.projectId,
      closeOperationId: input.operationId,
      eventKey: `project-close:finalized:${input.operationId}`,
      kind: "CLOSE_FINALIZED",
      payload: { completedAt: completedAt.toISOString() },
    },
    select: { id: true },
  });
  return event.id;
}

async function processClaimedProjectClose(
  claimed: ClaimedProjectClose,
  options: ProjectCloseSyncExecutionOptions,
): Promise<ProcessProjectCloseResult> {
  let processedSeries = 0;
  while (
    processedSeries < PROJECT_CLOSE_SERIES_BATCH_SIZE &&
    options.shouldContinue() &&
    !options.abortSignal.aborted &&
    Date.now() < options.deadlineMs
  ) {
    const outcome = await prisma.$transaction(async (tx) => {
      const operation = await tx.projectCloseOperation.findFirst({
        where: {
          id: claimed.id,
          state: ProjectCloseOperationState.CLOSING,
          leaseToken: claimed.leaseToken,
        },
        select: {
          id: true,
          projectId: true,
          cutoffAt: true,
          seriesCursor: true,
          project: { select: { workspaceId: true } },
        },
      });
      if (!operation) return { kind: "lost" as const };

      const candidateTask = await tx.task.findFirst({
        where: activeProjectScheduleWhere(
          operation.projectId,
          operation.seriesCursor,
        ),
        orderBy: { id: "asc" },
        select: { id: true, ownerId: true },
      });
      if (
        !(await lockCalendarScope(
          tx,
          operation.project.workspaceId,
          [operation.projectId],
          candidateTask?.ownerId,
        ))
      ) {
        return { kind: "lost" as const };
      }
      await updateOwnedProjectClose(tx, claimed, { leasedAt: new Date() });

      if (!candidateTask) {
        const eventId = await finalizeProjectClose(tx, {
          operationId: operation.id,
          leaseToken: claimed.leaseToken,
          projectId: operation.projectId,
          cutoffAt: operation.cutoffAt,
        });
        return eventId
          ? {
              kind: "closed" as const,
              eventId,
              workspaceId: operation.project.workspaceId,
            }
          : { kind: "restart" as const };
      }

      const resolved = await processSeries(tx, {
        operationId: operation.id,
        projectId: operation.projectId,
        cutoffAt: operation.cutoffAt,
        taskId: candidateTask.id,
      });
      await updateOwnedProjectClose(tx, claimed, {
        ...(resolved ? { seriesCursor: candidateTask.id } : {}),
        attempts: 0,
        failureSummary: Prisma.DbNull,
        leasedAt: new Date(),
      });
      return {
        kind: "processed" as const,
        workspaceId: operation.project.workspaceId,
      };
    });

    if (outcome.kind === "lost") break;
    if (outcome.kind === "closed") {
      await Promise.all([
        notifyProjectCloseTransition(outcome.eventId),
        deliverCalendarInvalidationsNow(outcome.workspaceId),
      ]);
      return { processedSeries, closed: true };
    }
    if (outcome.kind === "restart") continue;
    processedSeries += 1;
    await deliverCalendarInvalidationsNow(outcome.workspaceId);
  }

  await prisma.projectCloseOperation.updateMany({
    where: {
      id: claimed.id,
      state: ProjectCloseOperationState.CLOSING,
      leaseToken: claimed.leaseToken,
    },
    data: {
      leaseToken: null,
      leasedAt: null,
      nextAttemptAt: new Date(),
    },
  });
  return { processedSeries, closed: false };
}

async function recordProjectCloseFailure(
  claimed: ClaimedProjectClose,
  error: unknown,
): Promise<boolean> {
  const now = new Date();
  const current = await prisma.projectCloseOperation.findFirst({
    where: {
      id: claimed.id,
      state: ProjectCloseOperationState.CLOSING,
      leaseToken: claimed.leaseToken,
    },
    select: { attempts: true, projectId: true },
  });
  if (!current) return false;
  const attempts = current.attempts + 1;
  const failed = attempts >= PROJECT_CLOSE_MAX_FAILURES;
  const seriesTaskId =
    error instanceof ProjectCloseSeriesError ? error.seriesTaskId : null;
  const failureSummary = {
    seriesTaskId,
    message: "Scheduled work could not be closed",
  };
  const recorded = await prisma.$transaction(async (tx) => {
    const updated = await tx.projectCloseOperation.updateMany({
      where: {
        id: claimed.id,
        state: ProjectCloseOperationState.CLOSING,
        leaseToken: claimed.leaseToken,
      },
      data: {
        state: failed
          ? ProjectCloseOperationState.CLOSE_FAILED
          : ProjectCloseOperationState.CLOSING,
        attempts,
        leaseToken: null,
        leasedAt: null,
        nextAttemptAt: failed ? null : nextRetryAt(attempts, now),
        failureSummary,
      },
    });
    if (updated.count !== 1) return false;
    const event = await tx.projectEvent.create({
      data: {
        projectId: current.projectId,
        closeOperationId: claimed.id,
        eventKey: `project-close:failure:${claimed.id}:${claimed.leaseToken}`,
        kind: "BATCH_FAILED",
        payload: { attempts, failed, ...failureSummary },
      },
      select: { id: true },
    });
    return event.id;
  });
  if (!recorded) return false;
  if (failed) {
    await notifyProjectCloseTransition(recorded);
  }
  console.error("Project close batch failed", {
    closeOperationId: claimed.id,
    seriesTaskId,
    error,
  });
  return failed;
}

export const projectCloseSyncService = {
  async syncProjectCloses(
    options: ProjectCloseSyncExecutionOptions,
  ): Promise<ProjectCloseSyncResult> {
    await retryMissingProjectCloseNotifications(options);

    const result: ProjectCloseSyncResult = {
      claimed: 0,
      processedSeries: 0,
      closed: 0,
      failed: 0,
    };
    const claimed = await claimProjectCloses(new Date());
    result.claimed = claimed.length;

    for (const [index, operation] of claimed.entries()) {
      if (
        !options.shouldContinue() ||
        options.abortSignal.aborted ||
        Date.now() >= options.deadlineMs
      ) {
        await Promise.all(
          claimed.slice(index).map(async (unprocessed) => {
            await prisma.projectCloseOperation.updateMany({
              where: {
                id: unprocessed.id,
                state: ProjectCloseOperationState.CLOSING,
                leaseToken: unprocessed.leaseToken,
              },
              data: {
                leaseToken: null,
                leasedAt: null,
                nextAttemptAt: new Date(),
              },
            });
          }),
        );
        break;
      }
      try {
        const processed = await processClaimedProjectClose(operation, options);
        result.processedSeries += processed.processedSeries;
        if (processed.closed) result.closed += 1;
      } catch (error) {
        if (await recordProjectCloseFailure(operation, error)) {
          result.failed += 1;
        }
      }
    }
    return result;
  },
};
