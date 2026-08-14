"use server";

import * as Sentry from "@sentry/nextjs";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { type ActionError, CommonErrorCode } from "@/lib/actions";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { isJobError, JobErrorCode } from "@/lib/actions/errors/error-codes/job";
import { toCoreJobInputData } from "@/lib/actions/job/core-job-input";
import {
  CoreApiRequestError,
  coreClient,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import type { Job } from "@/lib/clients/generated/core";
import {
  type JobDetailsNameFormSchemaType,
  jobDetailsNameFormSchema,
  type ProvideJobInputSchemaType,
  provideJobInputSchema,
} from "@/lib/schemas";
import { jobService } from "@/lib/services";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface ProvideJobInputParameters extends AuthenticatedRequest {
  input: ProvideJobInputSchemaType;
}

interface MoveJobToWorkspaceParameters extends AuthenticatedRequest {
  agentId: string;
  jobId: string;
  organizationId: string | null;
}

export const provideJobInput = withSession<
  ProvideJobInputParameters,
  ActionResultDto<{ jobId: string }, ActionError>
>(async ({ input, session }) => {
  return await Sentry.withScope(async (scope) => {
    try {
      const userId = session.user.id;
      const { jobId, eventId, inputData } = input;

      // Validate input
      const parsedResult = provideJobInputSchema.safeParse(input);
      if (!parsedResult.success) {
        scope.setTag("error_type", "validation_error");
        scope.setContext("validation_error", {
          issues: parsedResult.error.issues,
        });

        Sentry.captureMessage(
          "Job input submission validation failed",
          "warning",
        );

        return toActionResult(
          err({
            message: "Bad Input",
            code: CommonErrorCode.BAD_INPUT,
          }),
        );
      }

      // Set user context for Sentry
      Sentry.setUser({
        id: userId,
      });

      // Set job context
      scope.setTag("action", "submitJobInput");
      scope.setTag("service", "job");
      scope.setContext("job_input_request", {
        jobId,
        inputDataSize: JSON.stringify(inputData).length,
      });

      // Add breadcrumb for job input submission flow
      Sentry.addBreadcrumb({
        category: "Job Action",
        message: "Submitting job input",
        level: "info",
        data: {
          jobId,
          eventId,
          userId,
        },
      });

      // Narrow input to the value union core accepts (files were already
      // uploaded client-side and replaced with references).
      const coreInputData = toCoreJobInputData(inputData);
      if (!coreInputData) {
        return toActionResult(
          err({
            message: "Bad Input",
            code: CommonErrorCode.BAD_INPUT,
          }),
        );
      }

      // Provide job input through core (ownership + agent call + input write
      // are enforced there; the caller revalidates via router.refresh()).
      await coreClient.provideJobInput(jobId, {
        eventId,
        inputData: coreInputData,
      });

      // Add success breadcrumb
      Sentry.addBreadcrumb({
        category: "Job Action",
        message: "Job input submitted successfully",
        level: "info",
        data: {
          jobId,
          eventId,
        },
      });

      return toActionResult(ok({ jobId }));
    } catch (error) {
      scope.setTag("error_type", "job_input_submission_error");
      scope.setContext("error", {
        message: error instanceof Error ? error.message : String(error),
      });

      Sentry.captureException(error, {
        contexts: {
          error_classification: {
            severity: "error",
            domain: "job_input_submission",
            category: "action_layer",
          },
        },
      });

      if (error instanceof CoreApiRequestError) {
        return toActionResult(err(toCoreApiActionError(error)));
      }

      if (isJobError(error)) {
        return toActionResult(
          err({
            message: error.message,
            code: error.code,
          }),
        );
      }

      return toActionResult(
        err({
          message: "Failed to submit job input",
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        }),
      );
    }
  });
});

export const moveJobToWorkspace = withSession<
  MoveJobToWorkspaceParameters,
  { jobId: string }
>(async ({ agentId, jobId, organizationId }) => {
  try {
    await jobService.moveJobToWorkspace(jobId, organizationId);
    revalidatePath(`/agents/${agentId}/jobs`);
    revalidatePath(`/agents/${agentId}/jobs/${jobId}`);
    return { jobId };
  } catch (error) {
    console.error("Failed to move job to workspace", error);
    const { message } = toCoreApiActionError(error);
    throw new Error(message ?? "Failed to move job to workspace");
  }
});

interface UpdateJobNameParameters extends AuthenticatedRequest {
  jobId: string;
  data: JobDetailsNameFormSchemaType;
}

export const updateJobName = withSession<
  UpdateJobNameParameters,
  ActionResultDto<void, ActionError>
>(async ({ jobId, data }) => {
  const parsedResult = jobDetailsNameFormSchema().safeParse(data);
  if (!parsedResult.success) {
    return toActionResult(
      err({
        message: "Bad Input",
        code: CommonErrorCode.BAD_INPUT,
      }),
    );
  }
  const parsed = parsedResult.data;

  try {
    await coreClient.patchJob(jobId, {
      name: parsed.name === "" ? null : parsed.name,
    });

    return toActionResult(ok());
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      if (error.status === 404) {
        return toActionResult(
          err({
            message: "Job not found",
            code: JobErrorCode.JOB_NOT_FOUND,
          }),
        );
      }

      if (error.status === 401 || error.status === 403) {
        return toActionResult(
          err({
            message: "Unauthorized",
            code: CommonErrorCode.UNAUTHORIZED,
          }),
        );
      }
    }

    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface RequestRefundJobParameters extends AuthenticatedRequest {
  jobId: string;
}

interface RequestRefundJobResponse {
  id: Job["id"];
  jobType: Job["jobType"];
  status: Job["status"];
}

export const requestRefundJob = withSession<
  RequestRefundJobParameters,
  ActionResultDto<{ job: RequestRefundJobResponse }, ActionError>
>(async ({ jobId }) => {
  try {
    const { data: job } = await coreClient.requestJobRefund(jobId);
    if (job.jobType !== "PAID") {
      return toActionResult(
        err({
          message: "Job not found",
          code: JobErrorCode.JOB_NOT_FOUND,
        }),
      );
    }

    return toActionResult(
      ok({
        job: {
          id: job.id,
          jobType: job.jobType,
          status: job.status as Job["status"],
        },
      }),
    );
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      if (error.status === 404) {
        return toActionResult(
          err({
            message: "Job not found",
            code: JobErrorCode.JOB_NOT_FOUND,
          }),
        );
      }

      if (error.status === 401 || error.status === 403) {
        return toActionResult(
          err({
            message: "Unauthorized",
            code: CommonErrorCode.UNAUTHORIZED,
          }),
        );
      }
    }

    return toActionResult(err(toCoreApiActionError(error)));
  }
});
