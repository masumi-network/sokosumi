"use server";

import * as Sentry from "@sentry/nextjs";
import { JobShare, PaidJobWithStatus } from "@sokosumi/database";
import {
  jobRepository,
  jobShareRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { revalidatePath } from "next/cache";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import { isJobError, JobErrorCode } from "@/lib/actions/errors/error-codes/job";
import prisma from "@/lib/db/prisma";
import {
  jobDetailsNameFormSchema,
  JobDetailsNameFormSchemaType,
  JobStatusResponseSchemaType,
  provideJobInputSchema,
  ProvideJobInputSchemaType,
  startJobInputSchema,
  StartJobInputSchemaType,
} from "@/lib/schemas";
import { callAgentHiredWebHook, jobService } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

import { handleInputDataFileUploads } from "./utils";

interface StartDemoJobParameters extends AuthenticatedRequest {
  input: Omit<StartJobInputSchemaType, "userId" | "maxAcceptedCents">;
  jobStatusResponse: JobStatusResponseSchemaType;
}

export const startDemoJob = withSession<
  StartDemoJobParameters,
  Result<{ jobId: string }, ActionError>
>(async ({ input, jobStatusResponse, session }) => {
  const userId = session.user.id;

  const inputDataForService: StartJobInputSchemaType = {
    ...input,
    userId,
    maxAcceptedCents: BigInt(0),
  };

  // Validation
  const parsedResult = startJobInputSchema.safeParse(inputDataForService);
  if (!parsedResult.success) {
    console.error(`Failed to start demo job: ${parsedResult.error}`);

    return Err({
      message: "Bad Input",
      code: CommonErrorCode.BAD_INPUT,
    });
  }
  const parsed = parsedResult.data;

  const job = await jobService.startDemoJob(parsed, jobStatusResponse);
  return Ok({ jobId: job.id });
});

interface StartJobParameters extends AuthenticatedRequest {
  input: Omit<StartJobInputSchemaType, "userId" | "organizationId">;
}

export const startJob = withSession<
  StartJobParameters,
  Result<{ jobId: string }, ActionError>
>(async ({ input, session }) => {
  return await Sentry.withScope(async (scope) => {
    try {
      const userId = session.user.id;
      const organizationId = session.session.activeOrganizationId ?? null;
      const inputDataForService: StartJobInputSchemaType = {
        ...input,
        userId,
        organizationId,
      };

      const user = await userRepository.getUserById(userId, prisma);
      if (!user) {
        return Err({
          message: "Unauthenticated",
          code: CommonErrorCode.UNAUTHENTICATED,
        });
      }

      // Set user context for Sentry
      Sentry.setUser({
        id: userId,
      });

      // Upload files if any and replace them with URLs in-place
      if (inputDataForService.inputData) {
        await handleInputDataFileUploads(userId, inputDataForService.inputData);
      }

      // Set job context
      scope.setTag("action", "startJobWithInputData");
      scope.setTag("service", "job");
      scope.setContext("job_request", {
        agentId: input.agentId,
        maxAcceptedCents: input.maxAcceptedCents,
        inputDataSize: JSON.stringify(input.inputData).length,
        organizationId: organizationId,
      });

      // Add breadcrumb for job start flow
      Sentry.addBreadcrumb({
        category: "Job Action",
        message: "Starting job with input data",
        level: "info",
        data: {
          agentId: input.agentId,
          userId: userId,
          organizationId: organizationId,
        },
      });

      // Validation
      const parsedResult = startJobInputSchema.safeParse(inputDataForService);

      if (!parsedResult.success) {
        scope.setTag("error_type", "validation_error");
        scope.setContext("validation_error", {
          issues: parsedResult.error.issues,
        });

        Sentry.captureMessage("Job start validation failed", "warning");

        return Err({
          message: "Bad Input",
          code: CommonErrorCode.BAD_INPUT,
        });
      }
      const parsed = parsedResult.data;

      const job = await jobService.startJob(parsed);

      // Add success breadcrumb
      Sentry.addBreadcrumb({
        category: "Job Action",
        message: "Job started successfully",
        level: "info",
        data: {
          jobId: job.id,
          agentId: input.agentId,
        },
      });

      // call after agent hired webhook
      callAgentHiredWebHook(userId, user.email);
      revalidatePath(`/agents/${input.agentId}/jobs/${job.id}`, "layout");
      return Ok({ jobId: job.id });
    } catch (error) {
      scope.setTag("error_type", "job_start_error");

      if (isJobError(error)) {
        // Type-safe error handling using error.code
        let sentryLevel: "warning" | "error" | "fatal" = "error";
        switch (error.code) {
          case JobErrorCode.INSUFFICIENT_BALANCE:
          case JobErrorCode.COST_TOO_HIGH:
            sentryLevel = "warning";
            break;
          case JobErrorCode.AGENT_NOT_FOUND:
          case JobErrorCode.AGENT_PRICING_NOT_FOUND:
          case JobErrorCode.INPUT_HASH_MISMATCH:
            sentryLevel = "error";
            break;
          default:
            sentryLevel = "fatal";
            break;
        }
        scope.setTag("error_code", error.code);
        scope.setContext("error_details", {
          originalMessage: error.message,
          mappedErrorCode: error.code,
          stack: error.stack,
        });
        Sentry.captureException(error, {
          contexts: {
            error_classification: {
              severity: sentryLevel,
              domain: "job_start",
              category: "action_layer",
            },
          },
        });
        return Err({
          message: error.message,
          code: error.code,
        });
      } else {
        // Generic fallback for unexpected errors
        scope.setTag("error_code", CommonErrorCode.INTERNAL_SERVER_ERROR);
        scope.setContext("error_details", {
          errorType: typeof error,
          errorValue: String(error),
        });
        Sentry.captureException(error, {
          contexts: {
            error_classification: {
              severity: "fatal",
              domain: "job_start",
              category: "action_layer",
            },
          },
        });
        return Err({
          message: "Internal server error",
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        });
      }
    }
  });
});

interface ProvideJobInputParameters extends AuthenticatedRequest {
  input: ProvideJobInputSchemaType;
}

export const provideJobInput = withSession<
  ProvideJobInputParameters,
  Result<{ jobId: string }, ActionError>
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

        return Err({
          message: "Bad Input",
          code: CommonErrorCode.BAD_INPUT,
        });
      }

      // Set user context for Sentry
      Sentry.setUser({
        id: userId,
      });

      // Upload files if any and replace them with URLs in-place
      await handleInputDataFileUploads(userId, inputData);

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

      // Call service to provide job input
      const { job } = await jobService.provideJobInput({
        jobId,
        eventId,
        userId,
        inputData,
      });

      // Add success breadcrumb
      Sentry.addBreadcrumb({
        category: "Job Action",
        message: "Job input submitted successfully",
        level: "info",
        data: {
          jobId: job.id,
          eventId,
          agentId: job.agentId,
        },
      });

      revalidatePath(`/agents/${job.agentId}/jobs/${job.id}`, "layout");
      return Ok({ jobId: job.id });
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

      if (isJobError(error)) {
        return Err({
          message: error.message,
          code: error.code,
        });
      }

      return Err({
        message: "Failed to submit job input",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
    }
  });
});

interface UpdateJobNameParameters extends AuthenticatedRequest {
  jobId: string;
  data: JobDetailsNameFormSchemaType;
}

export const updateJobName = withSession<
  UpdateJobNameParameters,
  Result<void, ActionError>
>(async ({ jobId, data, session }) => {
  const userId = session.user.id;

  const parsedResult = jobDetailsNameFormSchema().safeParse(data);
  if (!parsedResult.success) {
    return Err({
      message: "Bad Input",
      code: CommonErrorCode.BAD_INPUT,
    });
  }
  const parsed = parsedResult.data;

  const job = await jobRepository.getJobById(jobId, prisma);
  if (!job) {
    return Err({
      message: "Job not found",
      code: JobErrorCode.JOB_NOT_FOUND,
    });
  }

  // check job user id is same as authenticated user
  if (job.userId !== userId) {
    return Err({
      message: "Unauthorized",
      code: CommonErrorCode.UNAUTHORIZED,
    });
  }

  // update job name
  await jobRepository.updateJobNameById(
    jobId,
    parsed.name === "" ? null : parsed.name,
    prisma,
  );
  return Ok();
});

interface RequestRefundJobByBlockchainIdentifierParameters extends AuthenticatedRequest {
  blockchainIdentifier: string;
}

export const requestRefundJobByBlockchainIdentifier = withSession<
  RequestRefundJobByBlockchainIdentifierParameters,
  Result<{ job: PaidJobWithStatus }, ActionError>
>(async ({ blockchainIdentifier, session }) => {
  const userId = session.user.id;
  const foundJob = await jobRepository.getJobByBlockchainIdentifier(
    blockchainIdentifier,
    prisma,
  );
  if (!foundJob) {
    return Err({
      message: "Job not found",
      code: JobErrorCode.JOB_NOT_FOUND,
    });
  }

  // check user is owner of job
  if (foundJob.userId !== userId) {
    return Err({
      message: "Unauthorized",
      code: CommonErrorCode.UNAUTHORIZED,
    });
  }

  const job = await jobService.requestRefund(blockchainIdentifier);
  return Ok({ job });
});

// Share Features

interface ShareJobPubliclyParameters extends AuthenticatedRequest {
  jobId: string;
  allowSearchIndexing?: boolean;
}

export const shareJobPublicly = withSession<
  ShareJobPubliclyParameters,
  Result<JobShare, ActionError>
>(async ({ jobId, allowSearchIndexing, session }) => {
  const userId = session.user.id;
  try {
    return await prisma.$transaction(async (tx) => {
      const job = await jobRepository.getJobById(jobId, tx);
      if (!job) {
        return Err({
          message: "Job not found",
          code: JobErrorCode.JOB_NOT_FOUND,
        });
      }

      // must be job owner to share public
      if (userId !== job.userId) {
        return Err({
          message: "Unauthorized",
          code: CommonErrorCode.UNAUTHORIZED,
        });
      }

      const share = await jobShareRepository.upsertPublicShare(
        jobId,
        allowSearchIndexing,
        tx,
      );
      return Ok(share);
    });
  } catch (error) {
    console.error("Failed to share job in public", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});

interface UpdateAllowSearchIndexingParameters extends AuthenticatedRequest {
  jobShareId: string;
  allowSearchIndexing: boolean;
}

export const updateAllowSearchIndexing = withSession<
  UpdateAllowSearchIndexingParameters,
  Result<JobShare, ActionError>
>(async ({ jobShareId, allowSearchIndexing, session }) => {
  const userId = session.user.id;
  try {
    return await prisma.$transaction(async (tx) => {
      const share = await jobShareRepository.getShareById(jobShareId, tx);
      if (!share) {
        return Err({
          message: "Job share not found",
          code: JobErrorCode.JOB_SHARE_NOT_FOUND,
        });
      }
      // must be job owner to update allow search indexing
      if (userId !== share.job.userId) {
        return Err({
          message: "Unauthorized",
          code: CommonErrorCode.UNAUTHORIZED,
        });
      }

      // update allow search indexing
      const updatedShare =
        await jobShareRepository.setShareAllowSearchIndexingById(
          share.id,
          allowSearchIndexing,
          tx,
        );
      return Ok(updatedShare);
    });
  } catch (error) {
    console.error("Failed to update allow search indexing", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});

/**
 * Remove a job share by job id.
 *
 * @param jobId - The id of the job to remove the share for
 * @param session - The authentication context
 * @returns A result indicating success or failure
 */
interface DeleteJobShareParameters extends AuthenticatedRequest {
  jobId: string;
}

export const deleteJobShare = withSession<
  DeleteJobShareParameters,
  Result<void, ActionError>
>(async ({ jobId, session }) => {
  const userId = session.user.id;

  try {
    return await prisma.$transaction(async (tx) => {
      const job = await jobRepository.getJobById(jobId, tx);
      if (!job) {
        return Err({
          message: "Job not found",
          code: JobErrorCode.JOB_NOT_FOUND,
        });
      }

      // must be job owner to remove share
      if (userId !== job.userId) {
        return Err({
          message: "Unauthorized",
          code: CommonErrorCode.UNAUTHORIZED,
        });
      }

      await jobShareRepository.deleteShareByJobId(jobId, tx);
      return Ok();
    });
  } catch (error) {
    console.error("Failed to remove job public share", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});
