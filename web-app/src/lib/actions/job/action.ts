"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";

import {
  ActionError,
  CommonErrorCode,
  OrganizationErrorCode,
} from "@/lib/actions";
import { isJobError, JobErrorCode } from "@/lib/actions/errors/error-codes/job";
import { PaidJobWithStatus } from "@/lib/db";
import {
  jobPublicShareRepository,
  jobRepository,
  memberRepository,
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
import { callAgentHiredWebHook, jobService, userService } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";
import { JobPublicShare } from "@/prisma/generated/client";

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

interface ShareJobPubliclyParameters extends AuthenticatedRequest {
  jobId: string;
  allowSearchIndexing?: boolean;
}

export const shareJobPublicly = withAuthContext<
  ShareJobPubliclyParameters,
  Result<JobPublicShare, ActionError>
>(async ({ jobId, allowSearchIndexing, authContext }) => {
  const { userId } = authContext;
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

    // check if job is already shared publicly
    if (job.publicShare !== null) {
      return Err({
        message: "Job already shared publicly",
        code: JobErrorCode.JOB_ALREADY_SHARED_PUBLICLY,
      });
    }

    const publicShare = await jobPublicShareRepository.createShare(
      jobId,
      userId,
      allowSearchIndexing ?? true,
      tx,
    );
    return Ok(publicShare);
  });
});

interface ShareJobOrganizationParameters extends AuthenticatedRequest {
  jobId: string;
  share: boolean;
}

const setJobIsOrganizationShared = withAuthContext<
  ShareJobOrganizationParameters,
  Result<boolean, ActionError>
>(async ({ jobId, share, authContext }) => {
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

    // check if job is already shared with organization
    if (job.isOrganizationShared) {
      return Err({
        message: "Job already shared with organization",
        code: JobErrorCode.JOB_ALREADY_SHARED_ORGANIZATION,
      });
    }

    if (job.organizationId !== organizationId) {
      return Err({
        message: "You must be in the same organization to share jobs with it",
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

    const updatedJob = await jobRepository.setJobIsOrganizationSharedById(
      jobId,
      share,
      tx,
    );
    return Ok(updatedJob.isOrganizationShared);
  });
});

interface ShareWithOrganizationParameters extends AuthenticatedRequest {
  jobId: string;
}

export const shareWithOrganization = withAuthContext<
  ShareWithOrganizationParameters,
  Result<boolean, ActionError>
>(async ({ jobId, authContext }) => {
  return await setJobIsOrganizationShared({ jobId, share: true, authContext });
});

interface UnshareJobWithOrganizationParameters extends AuthenticatedRequest {
  jobId: string;
}

export const unshareJobWithOrganization = withAuthContext<
  UnshareJobWithOrganizationParameters,
  Result<boolean, ActionError>
>(async ({ jobId, authContext }) => {
  return await setJobIsOrganizationShared({ jobId, share: false, authContext });
});

interface UpdateAllowSearchIndexingParameters extends AuthenticatedRequest {
  jobShareId: string;
  allowSearchIndexing: boolean;
}

export const updateAllowSearchIndexing = withAuthContext<
  UpdateAllowSearchIndexingParameters,
  Result<JobPublicShare, ActionError>
>(async ({ jobShareId, allowSearchIndexing, authContext }) => {
  const { userId } = authContext;
  try {
    return await prisma.$transaction(async (tx) => {
      const publicShare = await jobPublicShareRepository.getShareById(
        jobShareId,
        tx,
      );
      if (!publicShare) {
        return Err({
          message: "Job public share not found",
          code: JobErrorCode.JOB_PUBLIC_SHARE_NOT_FOUND,
        });
      }

      // must be job share user to remove share
      if (userId !== publicShare.userId) {
        return Err({
          message: "Unauthorized",
          code: CommonErrorCode.UNAUTHORIZED,
        });
      }

      // update allow search indexing
      const updated =
        await jobPublicShareRepository.setShareAllowSearchIndexingById(
          publicShare.id,
          allowSearchIndexing,
          tx,
        );
      return Ok(updated);
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
interface UnshareJobPubliclyParameters extends AuthenticatedRequest {
  jobId: string;
}

export const unshareJobPublicly = withAuthContext<
  UnshareJobPubliclyParameters,
  Result<void, ActionError>
>(async ({ jobId, authContext }) => {
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

      // must be job owner to remove share
      if (userId !== job.userId) {
        return Err({
          message: "Unauthorized",
          code: CommonErrorCode.UNAUTHORIZED,
        });
      }

      await jobPublicShareRepository.deleteShareByJobId(jobId, tx);
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

interface UnshareJobParameters extends AuthenticatedRequest {
  jobId: string;
}

export const unshareJob = withAuthContext<
  UnshareJobParameters,
  Result<void, ActionError>
>(async ({ jobId, authContext }) => {
  await unshareJobPublicly({ jobId, authContext });
  await unshareJobWithOrganization({ jobId, authContext });
  return Ok();
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
