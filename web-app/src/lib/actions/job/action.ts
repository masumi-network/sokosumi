"use server";

import * as Sentry from "@sentry/nextjs";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import { isJobError, JobErrorCode } from "@/lib/actions/errors/error-codes/job";
import { JobWithStatus } from "@/lib/db";
import {
  jobRepository,
  jobShareRepository,
  prisma,
  userRepository,
} from "@/lib/db/repositories";
import {
  jobDetailsNameFormSchema,
  JobDetailsNameFormSchemaType,
  JobStatusResponseSchemaType,
  startJobInputSchema,
  StartJobInputSchemaType,
} from "@/lib/schemas";
import { callAfterAgentHiredWebHook, jobService } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";
import {
  JobShare,
  ShareAccessType,
  SharePermission,
} from "@/prisma/generated/client";

import {
  handleInputDataFileUploads,
  saveUploadedFiles,
  type UploadedFileWithMeta,
} from "./utils";

interface StartDemoJobParameters extends AuthenticatedRequest {
  input: Omit<StartJobInputSchemaType, "userId" | "maxAcceptedCents">;
  jobStatusResponse: JobStatusResponseSchemaType;
}

export const startDemoJob = withAuthContext<
  StartDemoJobParameters,
  Result<{ jobId: string }, ActionError>
>(async ({ input, jobStatusResponse, authContext }) => {
  const { userId } = authContext;

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

export const startJob = withAuthContext<
  StartJobParameters,
  Result<{ jobId: string }, ActionError>
>(async ({ input, authContext }) => {
  return await Sentry.withScope(async (scope) => {
    try {
      const { userId, organizationId } = authContext;
      const inputDataForService: StartJobInputSchemaType = {
        ...input,
        userId,
        organizationId,
      };

      const user = await userRepository.getUserById(userId);
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

      // Upload files if any
      let uploadedFiles: UploadedFileWithMeta[] = [];
      if (input.inputData) {
        uploadedFiles = await handleInputDataFileUploads(
          userId,
          input.inputData,
        );
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

      // Save files uploaded if any
      await saveUploadedFiles(userId, job.id, uploadedFiles);

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
      callAfterAgentHiredWebHook(user.email);

      return Ok({ jobId: job.id });
    } catch (error) {
      // Enhanced error handling with Sentry
      scope.setTag("error_type", "job_start_error");

      if (isJobError(error)) {
        // Type-safe error handling using error.code
        let sentryLevel: "warning" | "error" | "fatal" = "error";
        switch (error.code) {
          case JobErrorCode.INSUFFICIENT_BALANCE:
          case JobErrorCode.COST_TOO_HIGH:
            sentryLevel = "warning";
            break;
          case JobErrorCode.PRICING_SCHEMA_MISMATCH:
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

interface UpdateJobNameParameters extends AuthenticatedRequest {
  jobId: string;
  data: JobDetailsNameFormSchemaType;
}

export const updateJobName = withAuthContext<
  UpdateJobNameParameters,
  Result<void, ActionError>
>(async ({ jobId, data, authContext }) => {
  const { userId } = authContext;

  const parsedResult = jobDetailsNameFormSchema().safeParse(data);
  if (!parsedResult.success) {
    return Err({
      message: "Bad Input",
      code: CommonErrorCode.BAD_INPUT,
    });
  }
  const parsed = parsedResult.data;

  const job = await jobRepository.getJobById(jobId);
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
  );
  return Ok();
});

interface RequestRefundJobByBlockchainIdentifierParameters
  extends AuthenticatedRequest {
  blockchainIdentifier: string;
}

export const requestRefundJobByBlockchainIdentifier = withAuthContext<
  RequestRefundJobByBlockchainIdentifierParameters,
  Result<{ job: JobWithStatus }, ActionError>
>(async ({ blockchainIdentifier, authContext }) => {
  const { userId } = authContext;
  const foundJob =
    await jobRepository.getJobByBlockchainIdentifier(blockchainIdentifier);
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

interface ShareJobParameters extends AuthenticatedRequest {
  jobId: string;
  recipientId: string | null;
  recipientOrganizationId: string | null;
  shareAccessType: ShareAccessType;
  sharePermission: SharePermission;
}

export const shareJob = withAuthContext<
  ShareJobParameters,
  Result<JobShare, ActionError>
>(
  async ({
    jobId,
    recipientId,
    recipientOrganizationId,
    shareAccessType,
    sharePermission,
    authContext,
  }) => {
    const { userId } = authContext;
    try {
      const job = await jobRepository.getJobById(jobId);
      if (!job) {
        return Err({
          message: "Job not found",
          code: JobErrorCode.JOB_NOT_FOUND,
        });
      }

      // for now only public share is supported
      if (!!recipientId || !!recipientOrganizationId) {
        throw new Error("Only Public Share is supported");
      }

      // for now only Public Access is supported
      if (shareAccessType !== ShareAccessType.PUBLIC) {
        throw new Error("Only Public Access is supported");
      }

      // for now only Read access is supported
      if (sharePermission !== SharePermission.READ) {
        throw new Error("Only Read Permission is supported");
      }

      // must be job owner to share
      if (userId !== job.userId) {
        return Err({
          message: "Unauthorized",
          code: CommonErrorCode.UNAUTHORIZED,
        });
      }

      const jobShare = await prisma.$transaction(async (tx) => {
        await jobShareRepository.deleteJobSharesByJobId(jobId, tx);
        return await jobShareRepository.createJobShare(
          jobId,
          userId,
          recipientId,
          recipientOrganizationId,
          shareAccessType,
          sharePermission,
          tx,
        );
      });
      return Ok(jobShare);
    } catch (error) {
      console.error("Failed to share job", error);
      return Err({
        message: "Internal server error",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
    }
  },
);

interface UpdateAllowSearchIndexingParameters extends AuthenticatedRequest {
  jobShareId: string;
  allowSearchIndexing: boolean;
}

export const updateAllowSearchIndexing = withAuthContext<
  UpdateAllowSearchIndexingParameters,
  Result<JobShare, ActionError>
>(async ({ jobShareId, allowSearchIndexing, authContext }) => {
  const { userId } = authContext;
  try {
    const share = await jobShareRepository.getJobShareById(jobShareId);
    if (!share) {
      return Err({
        message: "Job Share not found",
        code: JobErrorCode.JOB_SHARE_NOT_FOUND,
      });
    }

    // must be job share creator to remove share
    if (userId !== share.creatorId) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }

    // update allow search indexing
    const updated = await jobShareRepository.updateJobShareAllowSearchIndexing(
      jobShareId,
      allowSearchIndexing,
    );
    return Ok(updated);
  } catch (error) {
    console.error("Failed to update allow search indexing", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});

interface RemoveJobShareParameters extends AuthenticatedRequest {
  jobId: string;
}

export const removeJobShare = withAuthContext<
  RemoveJobShareParameters,
  Result<void, ActionError>
>(async ({ jobId, authContext }) => {
  const { userId } = authContext;

  try {
    const job = await jobRepository.getJobById(jobId);
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

    await jobShareRepository.deleteJobSharesByJobId(jobId);
    return Ok();
  } catch (error) {
    console.error("Failed to remove job share", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});
