import * as Sentry from "@sentry/node";
import { type JobSchedule, ScheduleType } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
import { inputFieldsSchema, inputSchema } from "@sokosumi/masumi/schemas";
import { CronExpressionParser as cronParser } from "cron-parser";
import pLimit from "p-limit";

import { createAgentJobForUser } from "@/helpers/job";
import prisma from "@/lib/db/prisma";
import { syncLockService } from "@/services/sync-lock.service";

interface JobScheduleSyncResult {
  dueFound: number;
  processed: number;
  paused: number;
  durationMs: number;
}

function computeNextRun(cron: string, timezone: string, from: Date): Date | null {
  try {
    const interval = cronParser.parse(cron, {
      currentDate: from,
      tz: timezone,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

async function setScheduleActive(
  scheduleId: string,
  isActive: boolean,
  pauseReason?: string,
): Promise<void> {
  await prisma.jobSchedule.update({
    where: { id: scheduleId },
    data: {
      isActive,
      pauseReason,
    },
  });
}

async function setScheduleNextRun(
  scheduleId: string,
  nextRunAt: Date | null,
): Promise<void> {
  await prisma.jobSchedule.update({
    where: { id: scheduleId },
    data: {
      nextRunAt,
      isActive: nextRunAt !== null,
      pauseReason: null,
    },
  });
}

async function processSchedule(schedule: JobSchedule): Promise<boolean> {
  const lockKey = `job-schedule-${schedule.id}`;
  let lock: { key: string; ownerToken: string };

  try {
    lock = await syncLockService.acquireLock(lockKey);
  } catch (error) {
    console.error("Failed to acquire lock", error);
    return false;
  }

  try {
    const now = new Date();
    const isOneTime = schedule.scheduleType === ScheduleType.ONE_TIME;
    const isCron = schedule.scheduleType === ScheduleType.CRON;

    if (isCron && (!schedule.cron || !schedule.timezone)) {
      await setScheduleActive(schedule.id, false, "INVALID_CRON_CONFIG");
      return true;
    }

    const parsedInputSchema = inputFieldsSchema.safeParse(
      JSON.parse(schedule.inputSchema),
    );
    const parsedInputData = inputSchema.safeParse(JSON.parse(schedule.input));

    if (!parsedInputSchema.success || !parsedInputData.success) {
      throw new Error("Invalid schedule input payload");
    }

    await createAgentJobForUser({
      owner: {
        userId: schedule.userId,
        organizationId: schedule.organizationId,
      },
      agentInput: {
        agentId: schedule.agentId,
        inputData: parsedInputData.data,
        inputSchema: {
          input_data: parsedInputSchema.data,
        },
        maxCredits: convertCentsToCredits(schedule.maxAcceptedCents),
      },
      scheduleContext: {
        scheduleId: schedule.id,
      },
    });

    if (isOneTime) {
      await setScheduleNextRun(schedule.id, null);
      return true;
    }

    if (isCron && schedule.cron) {
      const next = computeNextRun(schedule.cron, schedule.timezone, now);
      if (!next) {
        await setScheduleActive(schedule.id, false, "INVALID_CRON");
        return true;
      }

      const jobsCount = await prisma.job.count({
        where: { jobScheduleId: schedule.id },
      });

      if (
        (schedule.endAfterOccurrences &&
          jobsCount >= schedule.endAfterOccurrences) ||
        (schedule.endOnUtc && next > schedule.endOnUtc)
      ) {
        await setScheduleNextRun(schedule.id, null);
        return true;
      }

      await setScheduleNextRun(schedule.id, next);
    }

    return true;
  } catch (error) {
    console.error("Error processing schedule", error);
    Sentry.captureException(error, { tags: { feature: "job-schedule" } });

    const message = error instanceof Error ? error.message : String(error);
    await setScheduleActive(schedule.id, false, message);
    return true;
  } finally {
    await syncLockService.releaseLock(lock.key, lock.ownerToken);
  }
}

export const jobScheduleSyncService = {
  async executeDueSchedules(): Promise<JobScheduleSyncResult> {
    const startedAt = Date.now();
    const due = await prisma.jobSchedule.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: new Date() },
      },
      orderBy: { nextRunAt: "asc" },
    });
    const limiter = pLimit(3);

    let processed = 0;
    let paused = 0;

    await Promise.all(
      due.map((schedule) =>
        limiter(async () => {
          const didProcess = await processSchedule(schedule);
          if (!didProcess) {
            return;
          }

          processed += 1;
          const after = await prisma.jobSchedule.findUnique({
            where: { id: schedule.id },
            select: { isActive: true },
          });

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
      durationMs: Date.now() - startedAt,
    };
  },
};
