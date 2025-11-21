"use server";

import * as Sentry from "@sentry/nextjs";
import { Prisma, ScheduleType } from "@sokosumi/database";
import { jobScheduleRepository } from "@sokosumi/database/repositories";
import { revalidatePath } from "next/cache";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes";
import { handleInputDataFileUploads } from "@/lib/actions/job/utils";
import { StartJobInputSchemaType } from "@/lib/schemas/job";
import { Result } from "@/lib/ts-res";
import { JobScheduleEndsMode, JobScheduleType } from "@/lib/types/job";
import { computeNextRun } from "@/lib/utils/cron";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

interface StartJobScheduleParameters extends AuthenticatedRequest {
  input: Omit<StartJobInputSchemaType, "userId" | "organizationId">;
}
interface ScheduleSelectionPayload {
  mode: JobScheduleType;
  timezone: string;
  oneTimeLocalIso?: string;
  cron?: string;
  endsMode?: JobScheduleEndsMode;
  endOnLocalDate?: string; // YYYY-MM-DD
  endAfterOccurrences?: number;
}

interface CreateScheduleInput extends AuthenticatedRequest {
  input: StartJobScheduleParameters["input"];
  scheduleSelection: ScheduleSelectionPayload;
}

export const createSchedule = withAuthContext<
  CreateScheduleInput,
  Result<
    { jobId: string; scheduleId: string },
    { code: string; message: string }
  >
>(async ({ input, scheduleSelection, authContext }) => {
  try {
    // Upload any Files in the input map to blob storage and replace with URLs
    if (input.inputData) {
      await handleInputDataFileUploads(authContext.userId, input.inputData);
    }

    // Derive schedule fields from selection and validate
    let scheduleType: JobScheduleType | null = null;
    let cron: string | null = null;
    let oneTimeAtUtc: string | undefined;
    let endOnUtc: string | undefined;
    let endAfterOccurrences: number | undefined;
    let nextRunAtIso: string | undefined;

    if (scheduleSelection.mode === JobScheduleType.ONE_TIME) {
      scheduleType = JobScheduleType.ONE_TIME;
      if (!scheduleSelection.oneTimeLocalIso) {
        return {
          ok: false,
          error: {
            code: CommonErrorCode.BAD_INPUT,
            message: "oneTimeLocalIso required",
          },
        };
      }
      // NOTE: This treats the provided local ISO as local time and converts using the runtime timezone,
      // matching previous client behavior. We rely on timezone only for CRON calculations.
      const parsed = new Date(scheduleSelection.oneTimeLocalIso);
      if (Number.isNaN(parsed.getTime())) {
        return {
          ok: false,
          error: {
            code: CommonErrorCode.BAD_INPUT,
            message: "Invalid oneTimeLocalIso",
          },
        };
      }
      oneTimeAtUtc = parsed.toISOString();
      nextRunAtIso = oneTimeAtUtc;
    } else if (scheduleSelection.mode === JobScheduleType.CRON) {
      scheduleType = JobScheduleType.CRON;
      if (!scheduleSelection.cron || !scheduleSelection.timezone) {
        return {
          ok: false,
          error: {
            code: CommonErrorCode.BAD_INPUT,
            message: "cron and timezone required",
          },
        };
      }
      cron = scheduleSelection.cron;
      const next = computeNextRun({
        cron,
        timezone: scheduleSelection.timezone,
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

      if (
        scheduleSelection.endsMode === JobScheduleEndsMode.ON &&
        scheduleSelection.endOnLocalDate
      ) {
        const e = new Date(`${scheduleSelection.endOnLocalDate}T23:59:59.999`);
        endOnUtc = e.toISOString();
      }
      if (scheduleSelection.endsMode === JobScheduleEndsMode.AFTER) {
        endAfterOccurrences = scheduleSelection.endAfterOccurrences;
      }
    } else {
      return {
        ok: false,
        error: {
          code: CommonErrorCode.BAD_INPUT,
          message: "Unsupported schedule mode",
        },
      };
    }

    // Build Prisma input directly
    const prismaInput: Prisma.JobScheduleCreateInput = {
      user: {
        connect: {
          id: authContext.userId,
        },
      },
      organization: authContext.organizationId
        ? {
            connect: {
              id: authContext.organizationId,
            },
          }
        : undefined,
      agent: {
        connect: {
          id: input.agentId,
        },
      },
      inputSchema: JSON.stringify(input.inputSchema),
      input: JSON.stringify(Object.fromEntries(input.inputData)),
      scheduleType: scheduleType! as ScheduleType,
      timezone: scheduleSelection.timezone,
      maxAcceptedCents: input.maxAcceptedCents,
      cron,
      oneTimeAtUtc,
      isActive: true,
      pauseReason: null,
      nextRunAt: nextRunAtIso,
    };
    if (endOnUtc !== undefined) prismaInput.endOnUtc = endOnUtc;
    if (endAfterOccurrences !== undefined)
      prismaInput.endAfterOccurrences = endAfterOccurrences;

    const schedule = await jobScheduleRepository.create(prismaInput);
    return { ok: true, data: { jobId: "", scheduleId: schedule.id } };
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
    await jobScheduleRepository.setActive(scheduleId, isActive);
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
