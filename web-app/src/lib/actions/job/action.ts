"use server";

import * as Sentry from "@sentry/nextjs";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import { isJobError, JobErrorCode } from "@/lib/actions/types/error-codes/job";
import { getSession } from "@/lib/auth/utils";
import { JobWithStatus } from "@/lib/db";
import { jobRepository } from "@/lib/db/repositories";
import {
  jobDetailsNameFormSchema,
  JobDetailsNameFormSchemaType,
  startJobInputSchema,
  StartJobInputSchemaType,
} from "@/lib/schemas";
import { jobService } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function startJobWithInputData(
  input: Omit<StartJobInputSchemaType, "userId">,
): Promise<Result<{ jobId: string }, ActionError>> {
  return await Sentry.withScope(async (scope) => {
    try {
      // Authentication
      const session = await getSession();
      if (!session) {
        return Err({
          message: "Unauthenticated",
          code: CommonErrorCode.UNAUTHENTICATED,
        });
      }
      const userId = session.user.id;
      const inputDataForService: StartJobInputSchemaType = { ...input, userId };

      // Set user context for Sentry
      Sentry.setUser({
        id: userId,
        email: session.user.email,
      });

      // Set job context
      scope.setTag("action", "startJobWithInputData");
      scope.setTag("service", "job");
      scope.setContext("job_request", {
        agentId: input.agentId,
        maxAcceptedCents: input.maxAcceptedCents,
        inputDataSize: JSON.stringify(input.inputData).length,
        organizationId: session.session.activeOrganizationId,
      });

      // Add breadcrumb for job start flow
      Sentry.addBreadcrumb({
        category: "Job Action",
        message: "Starting job with input data",
        level: "info",
        data: {
          agentId: input.agentId,
          userId: userId,
          organizationId: session.session.activeOrganizationId,
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
}

export async function updateJobName(
  jobId: string,
  data: JobDetailsNameFormSchemaType,
): Promise<Result<void, ActionError>> {
  try {
    // Authentication
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }
    const userId = session.user.id;

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
  } catch (error) {
    Sentry.withScope((scope) => {
      scope.setTag("action", "updateJobName");
      scope.setTag("service", "job");
      scope.setTag("error_type", "job_name_update_error");
      scope.setContext("job_update", {
        jobId: jobId,
        requestedName: data.name,
      });

      Sentry.captureException(error, {
        contexts: {
          error_classification: {
            severity: "error",
            domain: "job_update",
            category: "action_layer",
          },
        },
      });
    });

    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

export async function requestRefundJobByBlockchainIdentifier(
  blockchainIdentifier: string,
): Promise<Result<{ job: JobWithStatus }, ActionError>> {
  try {
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }

    const foundJob =
      await jobRepository.getJobByBlockchainIdentifier(blockchainIdentifier);
    if (!foundJob) {
      return Err({
        message: "Job not found",
        code: JobErrorCode.JOB_NOT_FOUND,
      });
    }

    // check user is owner of job
    if (foundJob.userId !== session.user.id) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }

    const job = await jobService.requestRefund(blockchainIdentifier);
    return Ok({ job });
  } catch (error) {
    Sentry.withScope((scope) => {
      scope.setTag("action", "requestRefundJobByBlockchainIdentifier");
      scope.setTag("service", "job");
      scope.setTag("error_type", "job_refund_error");
      scope.setContext("job_refund", {
        blockchainIdentifier: blockchainIdentifier,
      });

      Sentry.captureException(error, {
        contexts: {
          error_classification: {
            severity: "error",
            domain: "job_refund",
            category: "action_layer",
          },
        },
      });
    });

    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}
