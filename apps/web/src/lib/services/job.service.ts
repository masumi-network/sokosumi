import "server-only";

import * as Sentry from "@sentry/nextjs";
import {
  AgentJobStatus,
  type JobEvent,
  type JobWithSokosumiStatus,
  Prisma,
} from "@sokosumi/database";
import {
  jobEventRepository,
  jobInputRepository,
  jobRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";

import publishJobStatusData from "@/lib/ably/publish";
import type { JobStatusData } from "@/lib/ably/schema";
import { JobError, JobErrorCode } from "@/lib/actions/errors/error-codes/job";
import { toCoreJobInputData } from "@/lib/actions/job/core-job-input";
import { getSession } from "@/lib/auth/utils";
import { agentClient } from "@/lib/clients";
import { coreClient } from "@/lib/clients/core.client";
import prisma from "@/lib/db/prisma";
import { getJobStatusData } from "@/lib/helpers/job";
import type {
  JobStatusResponseSchemaType,
  ProvideJobInputSchemaType,
  StartJobInputSchemaType,
} from "@/lib/schemas";

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
   * @param tx - (Optional) A Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns A Promise that resolves to an array of JobStatusData or null (one for each agent ID).
   *
   * If the user session is not found, returns an empty array.
   */
  const getJobStatusesDataForAgents = async (
    agentIds: string[],
    tx: Prisma.TransactionClient = prisma,
  ): Promise<(JobStatusData | null)[]> => {
    const session = await getSession();
    if (!session) {
      return [];
    }
    const userId = session.user.id;
    const activeOrganizationId = session.session.activeOrganizationId ?? null;
    const workspace = await workspaceRepository.upsertWorkspaceForContext(
      userId,
      activeOrganizationId ?? null,
      tx,
    );

    return await Promise.all(
      agentIds.map(async (agentId) => {
        const latestJob =
          await jobRepository.getLatestJobByAgentIdUserIdAndWorkspace(
            agentId,
            userId,
            workspace.id,
            tx,
          );
        if (!latestJob) {
          return null;
        }
        return getJobStatusData(latestJob);
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

    // Get the job and verify ownership
    const job = await jobRepository.getJobById(jobId, prisma);
    if (!job || job.userId !== userId) {
      throw new JobError(JobErrorCode.JOB_NOT_FOUND, "Job not found");
    }
    const jobEvent = await jobEventRepository.getJobEventById(eventId, prisma);
    if (!jobEvent) {
      throw new JobError(JobErrorCode.JOB_NOT_FOUND, "Job status not found");
    }
    if (
      jobEvent.jobId !== jobId ||
      jobEvent.status !== AgentJobStatus.AWAITING_INPUT
    ) {
      throw new JobError(
        JobErrorCode.JOB_NOT_FOUND,
        "Job status not found or is not awaiting input",
      );
    }

    // Convert input data to JSON
    const inputJson = JSON.stringify(inputData);

    // Add breadcrumb for agent API call
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Calling agent API to provide input",
      level: "info",
      data: {
        jobId: job.id,
        eventId,
        jobEventId: jobEvent.id,
        agentId: job.agentId,
        agentJobId: job.agentJobId,
      },
    });

    const inputSchema = jobEvent.inputSchema;
    if (!inputSchema) {
      throw new JobError(
        JobErrorCode.JOB_INPUT_PROVIDE_FAILED,
        "Agent did not provide an input schema",
      );
    }

    // Call agent API to provide input
    const provideInputResult = await agentClient.provideJobInput(
      job.agent,
      job.agentJobId,
      inputSchema,
      inputData,
    );

    if (provideInputResult.isErr()) {
      Sentry.setTag("error_type", "agent_provide_input_failed");
      Sentry.setContext("agent_provide_input", {
        jobId: job.id,
        eventId,
        jobEventId: jobEvent.id,
        agentId: job.agentId,
        agentJobId: job.agentJobId,
        error: provideInputResult.error,
      });

      Sentry.captureMessage(
        `Agent provide input failed: ${provideInputResult.error}`,
        "error",
      );
      throw new JobError(
        JobErrorCode.JOB_INPUT_PROVIDE_FAILED,
        provideInputResult.error,
      );
    }

    const responseData = provideInputResult.value;

    const updatedJob = await prisma.$transaction(async (tx) => {
      await jobInputRepository.createJobInputForEventId(
        jobEvent.id,
        {
          input: inputJson,
          inputHash: responseData.input_hash,
          signature: responseData.signature,
        },
        tx,
      );

      // Refetch the job to get updated events
      const updatedJob = await jobRepository.getJobById(job.id, tx);
      if (!updatedJob) {
        throw new JobError(JobErrorCode.JOB_NOT_FOUND, "Job not found");
      }

      return updatedJob;
    });

    // Publish job status update
    await publishJobStatusSafely(updatedJob);

    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Job input provided successfully",
      level: "info",
      data: {
        jobId: updatedJob.id,
        eventId,
        jobEventId: jobEvent.id,
      },
    });

    return { job: updatedJob, jobEvent };
  };

  return {
    startDemoJob,
    moveJobToWorkspace,
    getJobStatusesDataForAgents,
    provideJobInput,
  };
})();
