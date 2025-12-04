import "server-only";

import * as Sentry from "@sentry/nextjs";
import { JobSchedule } from "@sokosumi/database";
import {
  jobScheduleRepository,
  lockRepository,
} from "@sokosumi/database/repositories";
import pLimit from "p-limit";

import { getEnvSecrets } from "@/config/env.secrets";
import publishJobStatusData from "@/lib/ably/publish";
import { startJobInputSchema, StartJobInputSchemaType } from "@/lib/schemas";
import { jobService } from "@/lib/services/job.service";
import { lockService } from "@/lib/services/lock.service";
import { JobScheduleType } from "@/lib/types/job";
import { computeNextRun } from "@/lib/utils/cron";

export const jobScheduleService = {
  async executeDueSchedules() {
    const startedAt = Date.now();
    const due = await jobScheduleRepository.findDue();
    const limiter = pLimit(3);

    let processed = 0;
    let paused = 0;

    await Promise.all(
      due.map((schedule) =>
        limiter(async () => {
          await processSchedule(schedule);
          const after = await jobScheduleRepository.getById(schedule.id);
          processed += 1;
          if (!after?.isActive) paused += 1;
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

    // Validate CRON before starting
    if (isCron) {
      if (!schedule.cron || !schedule.timezone) {
        await jobScheduleRepository.setActive(
          schedule.id,
          false,
          "INVALID_CRON_CONFIG",
        );
        return;
      }
    }

    const inputSchema = JSON.parse(
      schedule.inputSchema,
    ) as StartJobInputSchemaType["inputSchema"];
    const inputData = JSON.parse(
      schedule.input,
    ) as StartJobInputSchemaType["inputData"];

    // Validation
    const inputDataForService = {
      userId: schedule.userId,
      organizationId: schedule.organizationId,
      agentId: schedule.agentId,
      maxAcceptedCents: schedule.maxAcceptedCents,
      inputSchema,
      inputData,
      jobScheduleId: schedule.id,
    } as StartJobInputSchemaType;

    const parsedResult = startJobInputSchema.safeParse(inputDataForService);

    if (!parsedResult.success) {
      Sentry.captureMessage("Job start validation failed", "warning");

      throw new Error("Bad Input");
    }

    const parsed = parsedResult.data;

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

      const next = computeNextRun({
        cron: schedule.cron!,
        timezone: schedule.timezone,
        from: now,
      });
      if (!next) {
        await jobScheduleRepository.setActive(
          schedule.id,
          false,
          "INVALID_CRON",
        );
        return;
      }

      // After starting a job, count how many jobs have been created for this schedule
      const jobsCount = await jobScheduleRepository.countJobs(schedule.id);
      if (endAfterOccurrences && jobsCount >= endAfterOccurrences) {
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

    await jobScheduleRepository.setActive(schedule.id, false, message);
  } finally {
    try {
      await lockRepository.unlockByKey(lock.key);
    } catch {}
  }
}
