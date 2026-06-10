import "server-only";

import { JobError, JobErrorCode } from "@/lib/actions/errors/error-codes/job";
import { toCoreJobInputData } from "@/lib/actions/job/core-job-input";
import { coreClient } from "@/lib/clients/core.client";
import type {
  JobStatusResponseSchemaType,
  StartJobInputSchemaType,
} from "@/lib/schemas";

export const jobService = (() => {
  /**
   * Starts a demo job for a specified agent with the provided input data.
   *
   * Demo job creation (job + events) and source-import enqueueing live in core;
   * the agent-availability check and active-org/workspace resolution happen
   * server-side there.
   *
   * @param input - Job creation parameters including agent ID, input data, and input schema
   * @param jobStatusResponse - The demo job status response from the agent
   * @returns Promise resolving to the created job's id
   * @throws {JobError} When the input data cannot be sent to core
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

  return {
    startDemoJob,
    moveJobToWorkspace,
  };
})();
