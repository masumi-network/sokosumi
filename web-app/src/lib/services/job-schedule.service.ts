import "server-only";

import * as Sentry from "@sentry/nextjs";
import cronParser from "cron-parser";
import pLimit from "p-limit";

import { getEnvSecrets } from "@/config/env.secrets";
import publishJobStatusData from "@/lib/ably/publish";
import { jobScheduleRepository } from "@/lib/db/repositories/job-schedule.repository";
import { JobScheduleType } from "@/lib/db/types/job";
import { startJobInputSchema, StartJobInputSchemaType } from "@/lib/schemas";
import {
  computeNextRun,
  ComputeNextRunInput,
} from "@/lib/services/job-schedule.cron";
import { lockService } from "@/lib/services/lock.service";
import { JobSchedule } from "@/prisma/generated/client";

export type { ComputeNextRunInput };

export const jobScheduleService = {
  computeNextRun,

  async executeDueSchedules(limit = 50) {
    const startedAt = Date.now();
    const due = await jobScheduleRepository.findDue(limit);
    const limiter = pLimit(3);

    let processed = 0;
    let paused = 0;

    await Promise.all(
      due.map((schedule) =>
        limiter(async () => {
          const before = schedule.pauseReason;
          await processSchedule(schedule);
          const after = await jobScheduleRepository.getById(schedule.id);
          processed += 1;
          if (!before && after?.pauseReason) paused += 1;
        }),
      ),
    );

    const durationMs = Date.now() - startedAt;
    return { dueFound: due.length, processed, paused, durationMs };
  },
};

async function processSchedule(schedule: JobSchedule) {
  const lockKey = `job-schedule-${schedule.id}`;
  let lock;
  try {
    lock = await lockService.acquireLock(lockKey, getEnvSecrets().INSTANCE_ID);
  } catch (error) {
    // Already processing elsewhere
    console.error("Failed to acquire lock", error);
    return;
  }

  try {
    // Determine schedule type
    const now = new Date();
    const isOneTime = schedule.scheduleType === JobScheduleType.ONE_TIME;
    const isCron = schedule.scheduleType === JobScheduleType.CRON;

    // ONE_TIME: no extra timing validation needed here; findDue already filtered by nextRunAt <= now

    // Validate CRON alignment before starting
    if (isCron) {
      if (!schedule.cron || !schedule.timezone) {
        await jobScheduleRepository.setPaused(
          schedule.id,
          "INVALID_CRON_CONFIG",
        );
        return;
      }

      const toleranceMs = getEnvSecrets().JOB_SCHEDULE_ALIGNMENT_TOLERANCE_MS;
      let lastOccurrence: Date | null = null;
      try {
        const interval = cronParser.parse(schedule.cron, {
          tz: schedule.timezone,
          currentDate: now,
        });
        lastOccurrence = interval.prev().toDate();
      } catch {
        await jobScheduleRepository.setPaused(schedule.id, "INVALID_CRON");
        return;
      }

      const nextRunAt = schedule.nextRunAt ?? lastOccurrence;
      const isAligned =
        Math.abs(nextRunAt.getTime() - lastOccurrence.getTime()) <= toleranceMs;

      if (!isAligned) {
        const next = computeNextRun({
          cron: schedule.cron,
          timezone: schedule.timezone,
          from: now,
        });
        if (!next) {
          await jobScheduleRepository.setPaused(schedule.id, "INVALID_CRON");
          return;
        }
        await jobScheduleRepository.setNextRun(schedule.id, next);
        return;
      }
    }

    // Only after passing validation we mark the attempt and start the job
    await jobScheduleRepository.markRunAttempt(schedule.id);

    const inputSchema =
      schedule.inputSchema as StartJobInputSchemaType["inputSchema"];
    const inputRecord = JSON.parse(
      schedule.input,
    ) as StartJobInputSchemaType["inputData"];
    const inputData = new Map<string, unknown>(Object.entries(inputRecord));

    // Validation
    const inputDataForService = {
      userId: schedule.userId,
      organizationId: schedule.organizationId,
      agentId: schedule.agentId,
      maxAcceptedCents: schedule.maxAcceptedCents,
      inputSchema,
      inputData,
    } as StartJobInputSchemaType;

    const parsedResult = startJobInputSchema.safeParse(inputDataForService);

    if (!parsedResult.success) {
      Sentry.captureMessage("Job start validation failed", "warning");

      throw new Error("Bad Input");
    }

    const parsed = parsedResult.data;

    // Import jobService here to avoid circular dependency and fix unit tests
    const { jobService } = await import("@/lib/services/job.service");
    const result = await jobService.startJob(parsed);

    // Success → compute next run or deactivate if one-time
    if (isOneTime) {
      await jobScheduleRepository.setNextRun(schedule.id, null);
      return;
    }
    if (isCron) {
      // Enforce ends conditions
      const endOnUtc = schedule.endOnUtc;
      const endAfterOccurrences = schedule.endAfterOccurrences;
      const occurrenceCount = schedule.occurrenceCount;

      const next = computeNextRun({
        cron: schedule.cron!,
        timezone: schedule.timezone,
        from: now,
      });
      if (!next) {
        await jobScheduleRepository.setPaused(schedule.id, "INVALID_CRON");
        return;
      }

      // After this run, occurrenceCount has been incremented in markRunAttempt
      const updatedOccurrenceCount = occurrenceCount + 1;
      if (
        endAfterOccurrences &&
        updatedOccurrenceCount >= endAfterOccurrences
      ) {
        await jobScheduleRepository.setNextRun(schedule.id, null);
        return;
      }
      if (endOnUtc && next > endOnUtc) {
        await jobScheduleRepository.setNextRun(schedule.id, null);
        return;
      }
      await jobScheduleRepository.setNextRun(schedule.id, next);
    }

    try {
      await publishJobStatusData(result);
    } catch (err) {
      console.error("Error publishing job status data", err);
    }
  } catch (error) {
    console.error("Error processing schedule", error);

    Sentry.captureException(error, { tags: { feature: "job-schedule" } });

    const message = error instanceof Error ? error.message : String(error);

    await jobScheduleRepository.setPaused(schedule.id, message);
  } finally {
    try {
      const { lockRepository } = await import(
        "@/lib/db/repositories/lock.repository"
      );
      await lockRepository.unlockByKey(lock.key);
    } catch {}
  }
}
