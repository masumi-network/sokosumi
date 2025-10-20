"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes";
import { handleInputDataFileUploads } from "@/lib/actions/job/utils";
import { jobScheduleRepository } from "@/lib/db/repositories";
import { JobScheduleType } from "@/lib/db/types/job";
import { CreateJobScheduleInputSchemaType } from "@/lib/schemas/job";
import { Result } from "@/lib/ts-res";
import { computeNextRun } from "@/lib/utils/cron";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";
import { Prisma } from "@/prisma/generated/client";

interface CreateScheduleInput extends AuthenticatedRequest {
  input: CreateJobScheduleInputSchemaType;
}

export const createSchedule = withAuthContext<
  CreateScheduleInput,
  Result<{ scheduleId: string }, { code: string; message: string }>
>(async ({ input, authContext }) => {
  try {
    // Upload any Files in the input map to blob storage and replace with URLs
    if (input.inputData) {
      await handleInputDataFileUploads(authContext.userId, input.inputData);
    }

    // Derive nextRunAt on the server and validate inputs
    let nextRunAtIso: string | undefined;
    if (input.scheduleType === JobScheduleType.ONE_TIME) {
      if (!input.oneTimeAtUtc) {
        return {
          ok: false,
          error: {
            code: CommonErrorCode.BAD_INPUT,
            message: "oneTimeAtUtc required",
          },
        };
      }
      const parsed = new Date(input.oneTimeAtUtc);
      if (Number.isNaN(parsed.getTime())) {
        return {
          ok: false,
          error: {
            code: CommonErrorCode.BAD_INPUT,
            message: "Invalid oneTimeAtUtc",
          },
        };
      }
      nextRunAtIso = parsed.toISOString();
    } else if (input.scheduleType === JobScheduleType.CRON) {
      if (!input.cron || !input.timezone) {
        return {
          ok: false,
          error: {
            code: CommonErrorCode.BAD_INPUT,
            message: "cron and timezone required",
          },
        };
      }
      const next = computeNextRun({
        cron: input.cron,
        timezone: input.timezone,
      });
      if (!next) {
        return {
          ok: false,
          error: {
            code: CommonErrorCode.BAD_INPUT,
            message: "Invalid cron or timezone",
          },
        };
      }
      nextRunAtIso = next.toISOString();
    } else {
      return {
        ok: false,
        error: {
          code: CommonErrorCode.BAD_INPUT,
          message: "Unsupported scheduleType",
        },
      };
    }

    const data: CreateJobScheduleInputSchemaType = {
      userId: authContext.userId,
      ...(authContext.organizationId && {
        organizationId: authContext.organizationId,
      }),
      agentId: input.agentId,
      scheduleType: input.scheduleType,
      cron:
        input.scheduleType === JobScheduleType.CRON
          ? (input.cron ?? null)
          : null,
      oneTimeAtUtc:
        input.scheduleType === JobScheduleType.ONE_TIME
          ? new Date(input.oneTimeAtUtc as string).toISOString()
          : undefined,
      timezone: input.timezone,
      inputSchema: input.inputSchema,
      inputData: input.inputData,
      maxAcceptedCents: input.maxAcceptedCents,
      endOnUtc: input.endOnUtc
        ? new Date(input.endOnUtc).toISOString()
        : undefined,
      endAfterOccurrences: input.endAfterOccurrences ?? undefined,
      // Server-controlled defaults
      isActive: true,
      pauseReason: null,
      lastRunAt: null,
      nextRunAt: nextRunAtIso,
    };

    const schedule = await jobScheduleRepository.create(data);
    return { ok: true, data: { scheduleId: schedule.id } };
  } catch (error) {
    console.error("Failed to create schedule", error);
    Sentry.captureException(error, { tags: { action: "createSchedule" } });
    return {
      ok: false,
      error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR, message: "Failed" },
    };
  }
});

interface ToggleScheduleInput extends AuthenticatedRequest {
  scheduleId: string;
  isActive: boolean;
}

export const toggleSchedule = withAuthContext<
  ToggleScheduleInput,
  Result<void, { code: string; message: string }>
>(async ({ scheduleId, isActive, authContext }) => {
  try {
    const schedule = await jobScheduleRepository.getById(scheduleId);
    if (!schedule) {
      return {
        ok: false,
        error: { code: CommonErrorCode.BAD_INPUT, message: "Not found" },
      };
    }
    if (schedule.userId !== authContext.userId) {
      return {
        ok: false,
        error: { code: CommonErrorCode.UNAUTHORIZED, message: "Unauthorized" },
      };
    }
    await jobScheduleRepository.update(scheduleId, { isActive });
    revalidatePath("/schedules");
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("Failed to toggle schedule", error);
    Sentry.captureException(error, { tags: { action: "toggleSchedule" } });
    return {
      ok: false,
      error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR, message: "Failed" },
    };
  }
});

interface UpdateScheduleInput extends AuthenticatedRequest {
  scheduleId: string;
  data: {
    scheduleType: JobScheduleType;
    timezone: string;
    cron?: string | null;
    oneTimeAtUtc?: string | null;
    endOnUtc?: string | null;
    endAfterOccurrences?: number | null;
  };
}

export const updateSchedule = withAuthContext<
  UpdateScheduleInput,
  Result<void, { code: string; message: string }>
>(async ({ scheduleId, data, authContext }) => {
  try {
    const existing = await jobScheduleRepository.getById(scheduleId);
    if (!existing) {
      return {
        ok: false,
        error: { code: CommonErrorCode.BAD_INPUT, message: "Not found" },
      };
    }
    if (existing.userId !== authContext.userId) {
      return {
        ok: false,
        error: { code: CommonErrorCode.UNAUTHORIZED, message: "Unauthorized" },
      };
    }

    let nextRunAt: string | null = null;
    if (data.scheduleType === JobScheduleType.ONE_TIME) {
      nextRunAt = data.oneTimeAtUtc ?? null;
    } else if (data.scheduleType === JobScheduleType.CRON && data.cron) {
      const next = computeNextRun({ cron: data.cron, timezone: data.timezone });
      nextRunAt = next ? next.toISOString() : null;
    }

    await jobScheduleRepository.update(scheduleId, {
      scheduleType:
        data.scheduleType as Prisma.JobScheduleUpdateInput["scheduleType"],
      timezone: data.timezone,
      cron:
        data.scheduleType === JobScheduleType.CRON ? (data.cron ?? null) : null,
      oneTimeAtUtc:
        data.scheduleType === JobScheduleType.ONE_TIME
          ? data.oneTimeAtUtc
            ? new Date(data.oneTimeAtUtc)
            : null
          : null,
      endOnUtc: data.endOnUtc ? new Date(data.endOnUtc) : undefined,
      endAfterOccurrences:
        data.endAfterOccurrences === undefined
          ? undefined
          : data.endAfterOccurrences,
      nextRunAt: nextRunAt ? new Date(nextRunAt) : null,
      // when changing schedule, clear pause reason if any
      pauseReason: null,
    });
    revalidatePath("/schedules");
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("Failed to update schedule", error);
    Sentry.captureException(error, { tags: { action: "updateSchedule" } });
    return {
      ok: false,
      error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR, message: "Failed" },
    };
  }
});

interface DeleteScheduleInput extends AuthenticatedRequest {
  scheduleId: string;
}

export const deleteSchedule = withAuthContext<
  DeleteScheduleInput,
  Result<void, { code: string; message: string }>
>(async ({ scheduleId, authContext }) => {
  try {
    const schedule = await jobScheduleRepository.getById(scheduleId);
    if (!schedule) {
      return {
        ok: false,
        error: { code: CommonErrorCode.BAD_INPUT, message: "Not found" },
      };
    }
    if (schedule.userId !== authContext.userId) {
      return {
        ok: false,
        error: { code: CommonErrorCode.UNAUTHORIZED, message: "Unauthorized" },
      };
    }
    await jobScheduleRepository.delete(scheduleId);
    revalidatePath("/schedules");
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("Failed to delete schedule", error);
    Sentry.captureException(error, { tags: { action: "deleteSchedule" } });
    return {
      ok: false,
      error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR, message: "Failed" },
    };
  }
});
