import "server-only";

import * as Sentry from "@sentry/nextjs";
import type { JobEvent, JobWithSokosumiStatus } from "@sokosumi/database";

import publishJobStatusData from "@/lib/ably/publish";
import type { JobStatusData } from "@/lib/ably/schema";
import { JobError, JobErrorCode } from "@/lib/actions/errors/error-codes/job";
import { toCoreJobInputData } from "@/lib/actions/job/core-job-input";
import {
  mapCoreJobSummaryToJobWithSokosumiStatus,
  mapCoreJobToJobWithSokosumiStatus,
} from "@/lib/agents/core-dto-mappers";
import { getSession } from "@/lib/auth/utils";
import { coreClient, CoreApiRequestError } from "@/lib/clients/core.client";
import { getJobStatusData } from "@/lib/helpers/job";
import type {
  JobStatusResponseSchemaType,
  ProvideJobInputSchemaType,
  StartJobInputSchemaType,
} from "@/lib/schemas";

function mapCoreApiErrorToJobError(
  error: CoreApiRequestError,
  fallbackMessage: string,
): JobError {
  switch (error.status) {
    case 404:
      return new JobError(JobErrorCode.JOB_NOT_FOUND, error.message);
    case 409:
      return new JobError(
        JobErrorCode.JOB_INPUT_PROVIDE_FAILED,
        error.message || "Input has already been provided for this event",
      );
    case 422:
      return new JobError(JobErrorCode.JOB_INPUT_PROVIDE_FAILED, error.message);
    default:
      return new JobError(
        JobErrorCode.JOB_INPUT_PROVIDE_FAILED,
        fallbackMessage,
      );
  }
}

export const jobService = (() => {
  /**
   * Publishes job status data to Ably channels.
   * Errors are logged but not thrown.
   *
   * @param job - Job to publish status for
   */
  async function publishJobStatusSafely(
    job: JobWithSokosumiStatus,
  ): Promise<void> {
    try {
      await publishJobStatusData(job);
    } catch (err) {
      console.error("Error publishing job status data", err);
    }
  }

  /**
   * Starts a demo job for a specified agent with the provided input data.
   *
   * This function creates a job record with demo job-specific parameters and returns the created job.
   *
   * @param input - Job creation parameters including agent ID, user ID, input data, and input schema
   * @param jobStatusResponse - The demo job status response from the agent
   * @returns Promise resolving to the created Job record
   * @throws {JobError} Various job-related errors including agent not found, etc.
   */
  const startDemoJob = async (
    input: StartJobInputSchemaType,
    jobStatusResponse: JobStatusResponseSchemaType,
  ): Promise<{ id: string }> => {
    const { agentId, inputData, inputSchema } = input;

    const coreInputData = toCoreJobInputData(inputData);
    if (!coreInputData) {
      throw new JobError(
        JobErrorCode.AGENT_JOB_START_FAILED,
        "Demo job input data is not supported",
      );
    }

    // Demo job creation (job + events) and source-import enqueueing now live in
    // core; the agent-availability check and active-org/workspace resolution
    // happen server-side there.
    const result = await coreClient.createDemoJob(agentId, {
      inputData: coreInputData,
      inputSchema,
      result: jobStatusResponse.result ?? null,
    });

    return result.data;
  };

  const moveJobToWorkspace = async (
    jobId: string,
    organizationId: string | null,
  ) => {
    const result = await coreClient.moveJobToWorkspace(jobId, {
      organizationId,
    });

    if (!result.data) {
      throw new Error("Failed to move job to workspace");
    }

    return result.data;
  };

  /**
   * Retrieves the latest job status data for a list of agent IDs for the current user and organization.
   *
   * For each agent ID provided, this function fetches the most recent job associated with the agent,
   * the current user, and the active organization. If a job is found, it returns the job's status data;
   * otherwise, it returns null for that agent.
   *
   * @param agentIds - An array of agent IDs to fetch job status data for.
   * @returns A Promise that resolves to an array of JobStatusData or null (one for each agent ID).
   *
   * If the user session is not found, returns an empty array.
   */
  const getJobStatusesDataForAgents = async (
    agentIds: string[],
  ): Promise<(JobStatusData | null)[]> => {
    const session = await getSession();
    if (!session) {
      return [];
    }

    return await Promise.all(
      agentIds.map(async (agentId) => {
        const response = await coreClient.getJobs({
          agentId,
          scope: "owned",
          limit: 1,
        });
        const latestJob = response.data[0];
        if (!latestJob) {
          return null;
        }
        return getJobStatusData(
          mapCoreJobSummaryToJobWithSokosumiStatus(latestJob),
        );
      }),
    );
  };

  /**
   * Provides input for a job that is awaiting input (human-in-the-loop).
   *
   * This function:
   * - Validates the job exists and user owns it
   * - Validates the JobStatus (by eventId) is in awaiting input state
   * - Stores the provided input data
   * - Calls the agent API to provide input
   * - Updates the existing JobStatus with input data and new status
   *
   * @param input - Parameters including jobId, eventId, userId, and inputData
   * @returns Promise resolving to the updated Job record
   * @throws {JobError} Various job-related errors
   */
  const provideJobInput = async (
    input: ProvideJobInputSchemaType & { userId: string },
  ): Promise<{
    job: JobWithSokosumiStatus;
    jobEvent: JobEvent;
  }> => {
    const { jobId, eventId, userId, inputData } = input;

    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Providing job input",
      level: "info",
      data: {
        jobId,
        eventId,
        userId,
      },
    });

    const coreInputData = toCoreJobInputData(inputData);
    if (!coreInputData) {
      throw new JobError(
        JobErrorCode.JOB_INPUT_PROVIDE_FAILED,
        "Job input data is not supported",
      );
    }

    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Calling Core API to provide input",
      level: "info",
      data: {
        jobId,
        eventId,
      },
    });

    try {
      await coreClient.provideJobInput(jobId, {
        eventId,
        inputData: coreInputData,
      });
    } catch (error) {
      if (error instanceof CoreApiRequestError) {
        throw mapCoreApiErrorToJobError(error, "Failed to provide job input");
      }
      throw error;
    }

    const jobResponse = await coreClient.getJobById(jobId);
    const job = mapCoreJobToJobWithSokosumiStatus(jobResponse.data);
    const jobEvent = job.events.find((event) => event.id === eventId);

    if (!jobEvent) {
      throw new JobError(JobErrorCode.JOB_NOT_FOUND, "Job status not found");
    }

    await publishJobStatusSafely(job);

    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Job input provided successfully",
      level: "info",
      data: {
        jobId: job.id,
        eventId,
        jobEventId: jobEvent.id,
      },
    });

    return { job, jobEvent };
  };

  return {
    startDemoJob,
    moveJobToWorkspace,
    getJobStatusesDataForAgents,
    provideJobInput,
  };
})();
