import * as Sentry from "@sentry/node";
import { type JobSchedule, ScheduleType } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import { jobScheduleRepository } from "@sokosumi/database/repositories";
import {
  inputFieldsSchema,
  inputGroupsSchema,
  inputSchema as inputDataSchema,
  inputSchemaSchema,
  type InputSchemaSchemaType,
  type InputSchemaType,
} from "@sokosumi/masumi/schemas";
import pLimit from "p-limit";

import { computeNextRun } from "@/helpers/cron";
import { createAgentJobForUser } from "@/helpers/job";
import { publishJobStatusData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import type { AcquiredSyncLock } from "@/services/sync-lock.service";
import { syncLockService } from "@/services/sync-lock.service";

const JOB_SCHEDULE_SYNC_CONCURRENCY = 3;

export interface JobScheduleSyncExecutionOptions {
  abortSignal: AbortSignal;
  deadlineMs: number;
  shouldContinue: () => boolean;
}

export interface JobScheduleSyncResult {
  dueFound: number;
  processed: number;
  paused: number;
  skippedLocked: number;
  durationMs: number;
}

function hasTimeRemaining(deadlineMs: number): boolean {
  return Date.now() < deadlineMs;
}

function shouldStopSync(
  options: JobScheduleSyncExecutionOptions,
  reason: string,
): boolean {
  if (!options.shouldContinue()) {
    console.info(`[sync/job-schedules] ${reason}`);
    return true;
  }

  if (options.abortSignal.aborted) {
    console.info(`[sync/job-schedules] ${reason}`);
    return true;
  }

  if (!hasTimeRemaining(options.deadlineMs)) {
    console.info(`[sync/job-schedules] ${reason}`);
    return true;
  }

  return false;
}

function normalizeAndValidateInputSchema(
  parsed: unknown,
): InputSchemaSchemaType | null {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const objectResult = inputSchemaSchema.safeParse(parsed);
    if (objectResult.success) {
      return objectResult.data;
    }
    return null;
  }

  if (Array.isArray(parsed)) {
    const groupedResult = inputGroupsSchema.safeParse(parsed);
    if (groupedResult.success) {
      return { input_groups: groupedResult.data };
    }

    const fieldsResult = inputFieldsSchema.safeParse(parsed);
    if (fieldsResult.success) {
      return { input_data: fieldsResult.data };
    }

    return null;
  }

  return null;
}

function parseSchedulePayload(schedule: JobSchedule): {
  inputSchema: InputSchemaSchemaType;
  inputData: InputSchemaType;
} {
  const parsedInputSchema = normalizeAndValidateInputSchema(
    JSON.parse(schedule.inputSchema),
  );
  const parsedInputData = inputDataSchema.safeParse(JSON.parse(schedule.input));

  if (!parsedInputSchema || !parsedInputData.success) {
    throw new Error("Bad Input");
  }

  return {
    inputSchema: parsedInputSchema,
    inputData: parsedInputData.data,
  };
}

async function releaseScheduleLock(lock: AcquiredSyncLock): Promise<void> {
  try {
    const isReleased = await syncLockService.releaseLock(
      lock.key,
      lock.ownerToken,
    );
    if (!isReleased) {
      console.warn(
        `[sync/job-schedules] Lock not released because ownership changed (${lock.key})`,
      );
    }
  } catch (error) {
    console.error("Failed to unlock lock:", error);
  }
}

async function processSchedule(
  schedule: JobSchedule,
  options: JobScheduleSyncExecutionOptions,
): Promise<{
  processed: boolean;
  skippedLocked: boolean;
}> {
  if (
    shouldStopSync(
      options,
      `Stopping before schedule processing (${schedule.id})`,
    )
  ) {
    return {
      processed: false,
      skippedLocked: false,
    };
  }

  const lockKey = `job-schedule-${schedule.id}`;
  let lock: AcquiredSyncLock;
  try {
    lock = await syncLockService.acquireLock(lockKey);
  } catch (error) {
    if (error instanceof Error && error.message === "LOCK_IS_LOCKED") {
      return {
        processed: false,
        skippedLocked: true,
      };
    }
    console.error("Failed to acquire lock", error);
    return {
      processed: false,
      skippedLocked: false,
    };
  }

  try {
    if (
      shouldStopSync(
        options,
        `Stopping during schedule processing (${schedule.id})`,
      )
    ) {
      return {
        processed: false,
        skippedLocked: false,
      };
    }

    const now = new Date();
    const isOneTime = schedule.scheduleType === ScheduleType.ONE_TIME;
    const isCron = schedule.scheduleType === ScheduleType.CRON;

    if (isCron && (!schedule.cron || !schedule.timezone)) {
      await jobScheduleRepository.setActive(
        {
          id: schedule.id,
          isActive: false,
          pauseReason: "INVALID_CRON_CONFIG",
        },
        prisma,
      );
      return {
        processed: true,
        skippedLocked: false,
      };
    }

    const payload = parseSchedulePayload(schedule);

    const job = await createAgentJobForUser({
      owner: {
        userId: schedule.userId,
        organizationId: schedule.organizationId,
      },
      agentInput: {
        agentId: schedule.agentId,
        inputData: payload.inputData,
        inputSchema: payload.inputSchema,
        maxAcceptedCents: schedule.maxAcceptedCents,
      },
      scheduleContext: {
        jobScheduleId: schedule.id,
      },
    });

    if (isOneTime) {
      await jobScheduleRepository.setNextRun(schedule.id, null, prisma);
    } else if (isCron) {
      const next = computeNextRun({
        cron: schedule.cron!,
        timezone: schedule.timezone,
        from: now,
      });
      if (!next) {
        await jobScheduleRepository.setActive(
          {
            id: schedule.id,
            isActive: false,
            pauseReason: "INVALID_CRON",
          },
          prisma,
        );
        return {
          processed: true,
          skippedLocked: false,
        };
      }

      const jobsCount = await jobScheduleRepository.countJobs(schedule.id, prisma);
      if (
        schedule.endAfterOccurrences &&
        jobsCount >= schedule.endAfterOccurrences
      ) {
        await jobScheduleRepository.setNextRun(schedule.id, null, prisma);
      } else if (schedule.endOnUtc && next > schedule.endOnUtc) {
        await jobScheduleRepository.setNextRun(schedule.id, null, prisma);
      } else {
        await jobScheduleRepository.setNextRun(schedule.id, next, prisma);
      }
    }

    const mappedJob = mapJobWithStatus(job);
    try {
      await publishJobStatusData({
        agentId: job.agentId,
        userId: job.userId,
        jobId: job.id,
        jobStatus: mappedJob.status,
        jobStatusSettled: mappedJob.jobStatusSettled,
      });
    } catch (error) {
      console.error("Error publishing job status data", error);
    }

    return {
      processed: true,
      skippedLocked: false,
    };
  } catch (error) {
    console.error("Error processing schedule", error);
    Sentry.captureException(error, { tags: { feature: "job-schedule" } });

    const message = error instanceof Error ? error.message : String(error);
    await jobScheduleRepository.setActive(
      {
        id: schedule.id,
        isActive: false,
        pauseReason: message,
      },
      prisma,
    );

    return {
      processed: true,
      skippedLocked: false,
    };
  } finally {
    await releaseScheduleLock(lock);
  }
}

export const jobScheduleSyncService = {
  async executeDueSchedules(
    options: JobScheduleSyncExecutionOptions,
  ): Promise<JobScheduleSyncResult> {
    const startedAt = Date.now();
    const due = await jobScheduleRepository.findDue(prisma);
    const limiter = pLimit(JOB_SCHEDULE_SYNC_CONCURRENCY);

    let processed = 0;
    let paused = 0;
    let skippedLocked = 0;

    await Promise.all(
      due.map((schedule) =>
        limiter(async () => {
          if (
            shouldStopSync(
              options,
              `Stopping before scheduling due item (${schedule.id})`,
            )
          ) {
            return;
          }

          const scheduleResult = await processSchedule(schedule, options);
          if (scheduleResult.skippedLocked) {
            skippedLocked += 1;
            return;
          }

          if (!scheduleResult.processed) {
            return;
          }

          processed += 1;

          const after = await jobScheduleRepository.getById(schedule.id, prisma);
          if (!after?.isActive) {
            paused += 1;
          }
        }),
      ),
    );

    return {
      dueFound: due.length,
      processed,
      paused,
      skippedLocked,
      durationMs: Date.now() - startedAt,
    };
  },
};
