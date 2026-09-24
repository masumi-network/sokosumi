import { randomUUID } from "node:crypto";

import {
  Prisma,
  ProjectCloseOperationState,
  TaskScheduleRunState,
  TaskScheduleState,
} from "@sokosumi/database";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { lockCalendarScope } from "@/helpers/calendar-locks";
import {
  notifyProjectCloseTransition,
  retryMissingProjectCloseNotifications,
} from "@/helpers/project-close-notifications";
import prisma from "@/lib/db/prisma";
import {
  announceReleasedTasks,
  closeTaskScheduleForProject,
  type ReleasedTask,
} from "@/services/task-schedule-runs.service";

const PROJECT_CLOSE_OPERATION_BATCH_SIZE = 5;
const PROJECT_CLOSE_SCHEDULE_BATCH_SIZE = 10;
const PROJECT_CLOSE_RUN_BATCH_SIZE = 25;
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
  processedSchedules: number;
  closed: number;
  failed: number;
}

interface ClaimedProjectClose {
  id: string;
  leaseToken: string;
}

interface ProcessProjectCloseResult {
  processedSchedules: number;
  closed: boolean;
}

class ProjectCloseScheduleError extends Error {
  constructor(
    readonly scheduleId: string,
    cause: unknown,
  ) {
    super("Scheduled work could not be closed", { cause });
    this.name = "ProjectCloseScheduleError";
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

/**
 * Releases a batch of the Task Schedule's Runs owed before the cutoff, and
 * Ends it once none is owed (ADR 0041). An Ended schedule is no longer a
 * candidate, so schedules need no cursor.
 */
async function processTaskSchedule(
  tx: Prisma.TransactionClient,
  input: {
    operationId: string;
    projectId: string;
    cutoffAt: Date;
    scheduleId: string;
  },
): Promise<ReleasedTask[]> {
  try {
    const { tasks, ended } = await closeTaskScheduleForProject(
      tx,
      input.scheduleId,
      { cutoffAt: input.cutoffAt, limit: PROJECT_CLOSE_RUN_BATCH_SIZE },
    );
    if (ended) {
      await tx.projectEvent.create({
        data: {
          projectId: input.projectId,
          closeOperationId: input.operationId,
          eventKey: `project-close:schedule:${input.operationId}:${input.scheduleId}`,
          kind: "SERIES_RESOLVED",
          payload: { scheduleId: input.scheduleId },
        },
      });
    }
    return tasks;
  } catch (error) {
    throw new ProjectCloseScheduleError(input.scheduleId, error);
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
): Promise<string> {
  await tx.taskScheduleRun.updateMany({
    where: {
      sourceProjectId: input.projectId,
      state: {
        in: [TaskScheduleRunState.PLANNED, TaskScheduleRunState.SKIPPED],
      },
      effectiveScheduledAt: { gte: input.cutoffAt },
    },
    data: { state: TaskScheduleRunState.CANCELED },
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
  let processedSchedules = 0;
  while (
    processedSchedules < PROJECT_CLOSE_SCHEDULE_BATCH_SIZE &&
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
          project: { select: { workspaceId: true } },
        },
      });
      if (!operation) return { kind: "lost" as const };

      const candidateSchedule = await tx.taskSchedule.findFirst({
        where: {
          projectId: operation.projectId,
          state: { not: TaskScheduleState.ENDED },
        },
        orderBy: { id: "asc" },
        select: { id: true, ownerId: true },
      });
      if (
        !(await lockCalendarScope(
          tx,
          operation.project.workspaceId,
          [operation.projectId],
          candidateSchedule?.ownerId,
        ))
      ) {
        return { kind: "lost" as const };
      }
      await updateOwnedProjectClose(tx, claimed, { leasedAt: new Date() });

      if (!candidateSchedule) {
        const eventId = await finalizeProjectClose(tx, {
          operationId: operation.id,
          leaseToken: claimed.leaseToken,
          projectId: operation.projectId,
          cutoffAt: operation.cutoffAt,
        });
        return {
          kind: "closed" as const,
          eventId,
          workspaceId: operation.project.workspaceId,
        };
      }

      const tasks = await processTaskSchedule(tx, {
        operationId: operation.id,
        projectId: operation.projectId,
        cutoffAt: operation.cutoffAt,
        scheduleId: candidateSchedule.id,
      });
      await updateOwnedProjectClose(tx, claimed, {
        attempts: 0,
        failureSummary: Prisma.DbNull,
        leasedAt: new Date(),
      });
      return {
        kind: "processed" as const,
        workspaceId: operation.project.workspaceId,
        tasks,
      };
    });

    if (outcome.kind === "lost") break;
    if (outcome.kind === "closed") {
      await Promise.all([
        notifyProjectCloseTransition(outcome.eventId),
        deliverCalendarInvalidationsNow(outcome.workspaceId),
      ]);
      return { processedSchedules, closed: true };
    }
    processedSchedules += 1;
    await Promise.all([
      announceReleasedTasks(outcome.tasks),
      deliverCalendarInvalidationsNow(outcome.workspaceId),
    ]);
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
  return { processedSchedules, closed: false };
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
  // Names the failed Task Schedule, so cancel-owed can drop its owed Runs.
  const failureSummary = {
    scheduleId:
      error instanceof ProjectCloseScheduleError ? error.scheduleId : null,
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
    ...failureSummary,
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
      processedSchedules: 0,
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
        result.processedSchedules += processed.processedSchedules;
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
