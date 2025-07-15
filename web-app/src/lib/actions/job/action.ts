"use server";

import * as Sentry from "@sentry/nextjs";

import { ActionError, CommonErrorCode, JobErrorCode } from "@/lib/actions";
import { getSession } from "@/lib/auth/utils";
import { JobWithStatus } from "@/lib/db";
import {
  retrieveJobByBlockchainIdentifier,
  retrieveJobById,
  updateJobNameById,
} from "@/lib/db/repositories";
import {
  jobDetailsNameFormSchema,
  JobDetailsNameFormSchemaType,
  startJobInputSchema,
  StartJobInputSchemaType,
} from "@/lib/schemas";
import { requestRefundJob, startJob } from "@/lib/services";
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

      const job = await startJob(parsed);

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

      if (error instanceof Error) {
        // Map known error messages to structured error codes
        let errorCode: string;
        let errorMessage: string;
        let sentryLevel: "warning" | "error" | "fatal" = "error";

        switch (error.message) {
          case "Insufficient balance":
            errorCode = JobErrorCode.INSUFFICIENT_BALANCE;
            errorMessage = "Insufficient balance";
            sentryLevel = "warning";
            break;
          case "Agent not found":
            errorCode = JobErrorCode.AGENT_NOT_FOUND;
            errorMessage = "Agent not found";
            sentryLevel = "error";
            break;
          case "Agent pricing not found":
            errorCode = JobErrorCode.AGENT_PRICING_NOT_FOUND;
            errorMessage = "Agent pricing not found";
            sentryLevel = "error";
            break;
          case "Credit cost is too high":
            errorCode = JobErrorCode.COST_TOO_HIGH;
            errorMessage = "Credit cost is too high";
            sentryLevel = "warning";
            break;
          case "Pricing schemas have different lengths":
          case "Agent pricing not found for unit":
          case "Agent pricing for unit":
            errorCode = JobErrorCode.PRICING_SCHEMA_MISMATCH;
            errorMessage = "Pricing schema mismatch";
            sentryLevel = "error";
            break;
          case "Input data hash mismatch":
            errorCode = JobErrorCode.INPUT_HASH_MISMATCH;
            errorMessage = "Input data hash mismatch";
            sentryLevel = "error";
            break;
          default:
            errorCode = CommonErrorCode.INTERNAL_SERVER_ERROR;
            errorMessage = "Internal server error";
            sentryLevel = "fatal";
            break;
        }

        scope.setTag("error_code", errorCode);
        scope.setContext("error_details", {
          originalMessage: error.message,
          mappedErrorCode: errorCode,
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
          message: errorMessage,
          code: errorCode,
        });
      }

      // Handle non-Error objects
      scope.setTag("error_code", CommonErrorCode.INTERNAL_SERVER_ERROR);
      scope.setContext("error_details", {
        errorType: typeof error,
        errorValue: String(error),
      });

      Sentry.captureMessage(
        `Unknown error type in job start: ${String(error)}`,
        "fatal",
      );

      return Err({
        message: "Internal server error",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
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

    const job = await retrieveJobById(jobId);
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
    await updateJobNameById(jobId, parsed.name === "" ? null : parsed.name);
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
      await retrieveJobByBlockchainIdentifier(blockchainIdentifier);
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

    const job = await requestRefundJob(blockchainIdentifier);
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
