"use server";

import * as Sentry from "@sentry/nextjs";
import {
  AgentJobStatus,
  JobEventWithRelations,
  JobShare,
  PaidJobWithStatus,
} from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import {
  jobRepository,
  jobShareRepository,
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { revalidatePath } from "next/cache";

import {
  ActionError,
  CommonErrorCode,
  OrganizationErrorCode,
} from "@/lib/actions";
import { isJobError, JobErrorCode } from "@/lib/actions/errors/error-codes/job";
import {
  jobDetailsNameFormSchema,
  JobDetailsNameFormSchemaType,
  JobStatusResponseSchemaType,
  provideJobInputSchema,
  ProvideJobInputSchemaType,
  startJobInputSchema,
  StartJobInputSchemaType,
} from "@/lib/schemas";
import { callAgentHiredWebHook, jobService, userService } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

import {
  handleInputDataFileUploads,
  saveUploadedFilesForEventId,
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

      if (uploadedFiles.length > 0) {
        const initiatedEvent = job.events.find(
          (event: JobEventWithRelations) =>
            event.status === AgentJobStatus.INITIATED,
        );
        if (initiatedEvent) {
          await saveUploadedFilesForEventId(
            userId,
            initiatedEvent.id,
            uploadedFiles,
          );
        }
      }

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

export const provideJobInput = withAuthContext<
  ProvideJobInputParameters,
  Result<{ jobId: string }, ActionError>
>(async ({ input, authContext }) => {
  return await Sentry.withScope(async (scope) => {
    try {
      const { userId } = authContext;
      const { jobId, statusId, inputData } = input;

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

      // Upload files if any
      let uploadedFiles: Array<{
        url: string;
        fileName: string;
        size: number;
      }> = [];
      if (Object.keys(inputData).length > 0) {
        uploadedFiles = await handleInputDataFileUploads(userId, inputData);
      }

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
          statusId,
          userId,
        },
      });

      // Call service to provide job input
      const { job, jobEvent } = await jobService.provideJobInput({
        jobId,
        statusId,
        userId,
        inputData,
      });

      // Save uploaded files
      if (uploadedFiles.length > 0) {
        await saveUploadedFilesForEventId(userId, jobEvent.id, uploadedFiles);
      }

      // Add success breadcrumb
      Sentry.addBreadcrumb({
        category: "Job Action",
        message: "Job input submitted successfully",
        level: "info",
        data: {
          jobId: job.id,
          statusId,
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

interface RequestRefundJobByBlockchainIdentifierParameters extends AuthenticatedRequest {
  blockchainIdentifier: string;
}

export const requestRefundJobByBlockchainIdentifier = withAuthContext<
  RequestRefundJobByBlockchainIdentifierParameters,
  Result<{ job: PaidJobWithStatus }, ActionError>
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

// Share Features

interface ShareJobInPublicParameters extends AuthenticatedRequest {
  jobId: string;
  sharePublic: boolean;
  allowSearchIndexing?: boolean;
}

const shareJobInPublic = withAuthContext<
  ShareJobInPublicParameters,
  Result<JobShare, ActionError>
>(async ({ jobId, sharePublic, allowSearchIndexing, authContext }) => {
  const { userId } = authContext;
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
        sharePublic,
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

interface ShareJobPubliclyParameters extends AuthenticatedRequest {
  jobId: string;
  allowSearchIndexing?: boolean;
}

export const shareJobPublicly = withAuthContext<
  ShareJobPubliclyParameters,
  Result<JobShare, ActionError>
>(async ({ jobId, allowSearchIndexing, authContext }) => {
  return await shareJobInPublic({
    jobId,
    sharePublic: true,
    allowSearchIndexing: allowSearchIndexing ?? true,
    authContext,
  });
});

export const unshareJobPublicly = withAuthContext<
  ShareJobPubliclyParameters,
  Result<JobShare, ActionError>
>(async ({ jobId, allowSearchIndexing, authContext }) => {
  return await shareJobInPublic({
    jobId,
    sharePublic: false,
    allowSearchIndexing: allowSearchIndexing ?? true,
    authContext,
  });
});

interface ShareJobInOrganizationParameters extends AuthenticatedRequest {
  jobId: string;
  shareOrganization: boolean;
}

const shareJobInOrganization = withAuthContext<
  ShareJobInOrganizationParameters,
  Result<JobShare, ActionError>
>(async ({ jobId, shareOrganization, authContext }) => {
  const { userId, organizationId } = authContext;
  if (!organizationId) {
    return Err({
      message: "Unauthorized",
      code: CommonErrorCode.UNAUTHORIZED,
    });
  }
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

    if (organizationId !== job.organizationId) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }

    // Check if user is a member of the organization
    const membership =
      await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        organizationId,
        tx,
      );
    if (!membership) {
      return Err({
        message:
          "You must be a member of the organization to share jobs with it",
        code: OrganizationErrorCode.NOT_ORGANIZATION_MEMBER,
      });
    }

    const share = await jobShareRepository.upsertOrganizationShare(
      jobId,
      shareOrganization ? organizationId : null,
      tx,
    );
    return Ok(share);
  });
});

interface ShareJobWithOrganizationParameters extends AuthenticatedRequest {
  jobId: string;
}

export const shareJobWithOrganization = withAuthContext<
  ShareJobWithOrganizationParameters,
  Result<JobShare, ActionError>
>(async ({ jobId, authContext }) => {
  return await shareJobInOrganization({
    jobId,
    shareOrganization: true,
    authContext,
  });
});

export const unshareJobWithOrganization = withAuthContext<
  ShareJobWithOrganizationParameters,
  Result<JobShare, ActionError>
>(async ({ jobId, authContext }) => {
  return await shareJobInOrganization({
    jobId,
    shareOrganization: false,
    authContext,
  });
});

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
 * Remove job shares by job id and recipient organization id
 *
 * @param jobId - The id of the job to remove shares for
 * @param recipientOrganizationId - The id of the organization to remove shares for, if null, remove public shares
 * @param authContext - The authentication context
 * @returns A result indicating success or failure
 */
interface DeleteJobShareParameters extends AuthenticatedRequest {
  jobId: string;
}

export const deleteJobShare = withAuthContext<
  DeleteJobShareParameters,
  Result<void, ActionError>
>(async ({ jobId, authContext }) => {
  const { userId, organizationId } = authContext;

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

      // If job belongs to an organization, require matching active organization
      if (job.organizationId) {
        if (!organizationId || organizationId !== job.organizationId) {
          return Err({
            message: "Unauthorized",
            code: CommonErrorCode.UNAUTHORIZED,
          });
        }
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

export const getActiveOrganization = withAuthContext<
  AuthenticatedRequest,
  Result<{ id: string; name: string } | null, ActionError>
>(async () => {
  try {
    const organization = await userService.getActiveOrganization();
    if (!organization) {
      return Ok(null);
    }
    return Ok({ id: organization.id, name: organization.name });
  } catch (error) {
    console.error("Failed to get active organization", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});

export const getActiveOrganizationId = withAuthContext<
  AuthenticatedRequest,
  Result<string | null, ActionError>
>(async () => {
  try {
    const organizationId = await userService.getActiveOrganizationId();
    return Ok(organizationId);
  } catch (error) {
    console.error("Failed to get active organization id", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});
