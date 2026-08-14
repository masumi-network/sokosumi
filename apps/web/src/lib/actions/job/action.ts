"use server";

import * as Sentry from "@sentry/nextjs";
import { convertCentsToCredits } from "@sokosumi/utils";
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
  type StartJobInputSchemaType,
  startJobInputSchema,
} from "@/lib/schemas";
import { callAgentHiredWebHook, jobService } from "@/lib/services";
import { normalizeOptionalProjectId } from "@/lib/utils/project";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const ZERO_ACCEPTED_CENTS = BigInt(0);

async function resolveAvailableCredits(): Promise<number | null> {
  try {
    const credits = await coreClient.getMyCredits();
    const subscriptionRemaining =
      credits.data?.subscription?.credits?.remaining ?? null;
    const extraRemaining = credits.data?.extra?.credits?.remaining ?? null;

    if (subscriptionRemaining == null && extraRemaining == null) return null;

    return (subscriptionRemaining ?? 0) + (extraRemaining ?? 0);
  } catch (error) {
    Sentry.withScope((scope) => {
      scope.setTag("error_type", "credit_balance_check_failed");
      scope.setContext("credit_balance_check", {
        error: error instanceof Error ? error.message : String(error),
      });
      Sentry.captureException(error, {
        contexts: {
          error_classification: {
            severity: "warning",
            domain: "job_start",
            category: "credit_balance_preflight",
          },
        },
      });
    });

    return null;
  }
}

/**
 * Loads agent metadata from Core for job start. Sentry tagging here must only
 * reflect `GET /agents/{id}` failures — keep name-generation reporting separate.
 */
async function fetchAgentRowForCoreJobStart(agentId: string): Promise<{
  name: string;
  description: string;
  credits: number;
} | null> {
  try {
    const { data: agent } = await coreClient.getAgentById(agentId);
    if (agent == null) {
      Sentry.withScope((scope) => {
        scope.setTag("error_type", "job_start_agent_fetch_failed");
        scope.setContext("job_start_agent_fetch", {
          agentId,
          error: "empty_agent_response",
        });
        Sentry.captureMessage(
          "Job start agent fetch returned no agent payload",
          {
            level: "warning",
            contexts: {
              error_classification: {
                severity: "warning",
                domain: "job_start",
                category: "core_api",
              },
            },
          },
        );
      });
      return null;
    }

    return {
      name: agent.name,
      description: agent.description,
      credits: agent.credits,
    };
  } catch (error) {
    Sentry.withScope((scope) => {
      scope.setTag("error_type", "job_start_agent_fetch_failed");
      scope.setContext("job_start_agent_fetch", {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      Sentry.captureException(error, {
        contexts: {
          error_classification: {
            severity: "warning",
            domain: "job_start",
            category: "core_api",
          },
        },
      });
    });

    return null;
  }
}

function mapCoreStartJobError(error: CoreApiRequestError): ActionError {
  if (error.status === 401 || error.status === 403) {
    return {
      message: "Unauthenticated",
      code: CommonErrorCode.UNAUTHENTICATED,
    };
  }

  if (error.status === 404) {
    return {
      message: "Agent not found",
      code: JobErrorCode.AGENT_NOT_FOUND,
    };
  }

  if (error.message.includes("Insufficient balance")) {
    return {
      message: "Insufficient balance",
      code: JobErrorCode.INSUFFICIENT_BALANCE,
    };
  }

  if (error.message.includes("maximum accepted")) {
    return {
      message: "Credit cost is too high",
      code: JobErrorCode.COST_TOO_HIGH,
    };
  }

  if (typeof error.status === "number" && error.status >= 500) {
    return toCoreApiActionError(error);
  }

  return {
    message: error.message,
    code: JobErrorCode.AGENT_JOB_START_FAILED,
  };
}

interface StartJobParameters extends AuthenticatedRequest {
  input: Omit<StartJobInputSchemaType, "userId" | "organizationId">;
}

export const startJob = withSession<
  StartJobParameters,
  ActionResultDto<{ jobId: string }, ActionError>
>(async ({ input, session }) => {
  return await Sentry.withScope(async (scope) => {
    try {
      const userId = session.user.id;
      const organizationId = session.session.activeOrganizationId ?? null;
      const projectId = normalizeOptionalProjectId(input.projectId);
      const inputDataForService: StartJobInputSchemaType = {
        ...input,
        userId,
        organizationId,
        projectId,
      };

      // Set user context for Sentry
      Sentry.setUser({
        id: userId,
      });

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

        return toActionResult(
          err({
            message: "Bad Input",
            code: CommonErrorCode.BAD_INPUT,
          }),
        );
      }
      const parsed = parsedResult.data;
      const coreInputData = toCoreJobInputData(parsed.inputData);
      if (!coreInputData) {
        scope.setTag("error_type", "validation_error");
        scope.setContext("validation_error", {
          reason: "unsupported_core_input_data",
        });

        Sentry.captureMessage(
          "Job start input data is not core-compatible",
          "warning",
        );

        return toActionResult(
          err({
            message: "Bad Input",
            code: CommonErrorCode.BAD_INPUT,
          }),
        );
      }

      const agentRow = await fetchAgentRowForCoreJobStart(parsed.agentId);
      const agentCredits = agentRow == null ? null : agentRow.credits;

      const maxCredits = convertCentsToCredits(parsed.maxAcceptedCents);

      if (parsed.maxAcceptedCents === ZERO_ACCEPTED_CENTS) {
        if (agentCredits == null) {
          return toActionResult(
            err({
              message: "Credit cost is too high",
              code: JobErrorCode.COST_TOO_HIGH,
            }),
          );
        }

        if (agentCredits > 0) {
          return toActionResult(
            err({
              message: "Credit cost is too high",
              code: JobErrorCode.COST_TOO_HIGH,
            }),
          );
        }
      }

      // Core currently starts the external job before its own balance validation.
      // Preflight locally to avoid launching upstream work for guaranteed
      // insufficient-balance requests.
      if (agentCredits != null && agentCredits > 0) {
        const availableCredits = await resolveAvailableCredits();

        if (availableCredits == null) {
          return toActionResult(
            err({
              message: "Failed to verify credit balance",
              code: CommonErrorCode.INTERNAL_SERVER_ERROR,
            }),
          );
        }

        if (availableCredits < agentCredits) {
          return toActionResult(
            err({
              message: "Insufficient balance",
              code: JobErrorCode.INSUFFICIENT_BALANCE,
            }),
          );
        }
      }

      const job = await coreClient.createAgentJob(parsed.agentId, {
        inputSchema: parsed.inputSchema,
        inputData: coreInputData,
        ...(parsed.maxAcceptedCents !== ZERO_ACCEPTED_CENTS
          ? { maxCredits }
          : {}),
        ...(typeof parsed.projectId !== "undefined"
          ? { projectId: parsed.projectId }
          : {}),
      });

      // Add success breadcrumb
      Sentry.addBreadcrumb({
        category: "Job Action",
        message: "Job started successfully",
        level: "info",
        data: {
          jobId: job.data.id,
          agentId: input.agentId,
        },
      });

      // call after agent hired webhook
      void callAgentHiredWebHook(userId, session.user.email);
      revalidatePath(`/agents/${input.agentId}/jobs/${job.data.id}`, "layout");
      return toActionResult(ok({ jobId: job.data.id }));
    } catch (error) {
      scope.setTag("error_type", "job_start_error");

      if (error instanceof CoreApiRequestError) {
        const actionError = mapCoreStartJobError(error);
        scope.setTag("error_code", actionError.code);
        scope.setContext("error_details", {
          originalMessage: error.message,
          mappedErrorCode: actionError.code,
          status: error.status,
          details: error.details,
          stack: error.stack,
        });
        Sentry.captureException(error, {
          contexts: {
            error_classification: {
              severity:
                actionError.code === JobErrorCode.INSUFFICIENT_BALANCE ||
                actionError.code === JobErrorCode.COST_TOO_HIGH
                  ? "warning"
                  : "error",
              domain: "job_start",
              category: "core_api",
            },
          },
        });
        return toActionResult(err(actionError));
      } else if (isJobError(error)) {
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
        return toActionResult(
          err({
            message: error.message,
            code: error.code,
          }),
        );
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
        return toActionResult(
          err({
            message: "Internal server error",
            code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          }),
        );
      }
    }
  });
});

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
