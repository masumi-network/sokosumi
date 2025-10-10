"use server";

import * as Sentry from "@sentry/nextjs";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes";
import { jobScheduleRepository } from "@/lib/db/repositories";
import { CreateJobScheduleInputSchemaType } from "@/lib/schemas/job";
import { Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

interface CreateScheduleInput extends AuthenticatedRequest {
  input: CreateJobScheduleInputSchemaType;
}

export const createSchedule = withAuthContext<
  CreateScheduleInput,
  Result<{ scheduleId: string }, { code: string; message: string }>
>(async ({ input, authContext }) => {
  try {
    console.log("input", input);
    const data: CreateJobScheduleInputSchemaType = {
      userId: authContext.userId,
      ...(authContext.organizationId && {
        organizationId: authContext.organizationId,
      }),
      agentId: input.agentId,
      scheduleType: input.scheduleType,
      cron: input.cron,
      oneTimeAtUtc: input.oneTimeAtUtc
        ? new Date(input.oneTimeAtUtc).toISOString()
        : undefined,
      timezone: input.timezone,
      inputSchema: input.inputSchema,
      inputData: input.inputData,
      maxAcceptedCents: input.maxAcceptedCents,
      endOnUtc: input.endOnUtc
        ? new Date(input.endOnUtc).toISOString()
        : undefined,
      endAfterOccurrences: input.endAfterOccurrences ?? undefined,
      isActive: true,
      lastRunAt: null,
      nextRunAt: input.nextRunAt
        ? new Date(input.nextRunAt).toISOString()
        : undefined,
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
