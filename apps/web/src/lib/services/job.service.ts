import "server-only";

import * as Sentry from "@sentry/nextjs";
import {
  AgentJobStatus,
  type AgentWithRelations,
  type JobEvent,
  JobType,
  type JobWithSokosumiStatus,
  NextJobAction,
  type PaidJobWithStatus,
  PricingType,
  Prisma,
} from "@sokosumi/database";
import {
  isPaidJob,
  resolveWorkspaceForContext,
} from "@sokosumi/database/helpers";
import {
  creditBucketRepository,
  jobEventRepository,
  jobInputRepository,
  jobPurchaseRepository,
  jobRepository,
} from "@sokosumi/database/repositories";
import type { InputSchemaType } from "@sokosumi/masumi/schemas";
import { track } from "@vercel/analytics/server";
import { v4 as uuidv4 } from "uuid";

import publishJobStatusData from "@/lib/ably/publish";
import type { JobStatusData } from "@/lib/ably/schema";
import { JobError, JobErrorCode } from "@/lib/actions/errors/error-codes/job";
import { getSession } from "@/lib/auth/utils";
import { agentClient, openrouterClient, paymentClient } from "@/lib/clients";
import { coreClient } from "@/lib/clients/core.client";
import prisma from "@/lib/db/prisma";
import { getJobStatusData } from "@/lib/helpers/job";
import type {
  JobStatusResponseSchemaType,
  ProvideJobInputSchemaType,
  StartJobInputSchemaType,
} from "@/lib/schemas";
import { transformPurchaseToJobUpdate } from "@/lib/utils/job-transformers";

import { agentService } from "./agent.service";
import { sourceImportService } from "./source-import.service";
import { userService } from "./user.service";

export const jobService = (() => {
  /**
   * Validates that a user has sufficient credit balance (in cents) to cover a specified amount.
   *
   * This function retrieves the user's current credit balance in cents and checks if it is
   * greater than or equal to the required amount. If the balance is insufficient, it throws an error.
   *
   * @param userId - The ID of the user whose balance is being validated.
   * @param cents - The amount (in cents) to validate against the user's balance.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @throws Error if the user's balance is insufficient to cover the specified amount.
   */
  const validateBalance = async (
    userId: string,
    organizationId: string | null,
    cents: bigint,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> => {
    const centsBalance = await creditBucketRepository.getBalance(
      userId,
      organizationId,
      tx,
    );
    if (centsBalance - cents < BigInt(0)) {
      throw new JobError(
        JobErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance",
      );
    }
  };

  /**
   * Generates a job name using AI based on agent information and input data.
   * Returns null if generation fails.
   *
   * @param agent - Agent with name and description
   * @param inputData - Input data for the job
   * @returns Generated job name or null if generation fails
   */
  async function generateJobNameForAgent(
    agent: { name: string; description: string | null },
    inputData: InputSchemaType,
  ): Promise<string | null> {
    try {
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Generating job name via AI",
        level: "info",
        data: { agentName: agent.name },
      });

      return await openrouterClient.generateJobName(
        { name: agent.name, description: agent.description },
        inputData,
      );
    } catch (error) {
      Sentry.withScope((scope) => {
        scope.setTag("error_type", "job_name_generation_failed");
        Sentry.captureException(error, {
          contexts: {
            error_classification: {
              severity: "warning",
              domain: "job_name_generation",
              category: "service_layer",
            },
          },
        });
      });
      return null;
    }
  }

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
  ): Promise<JobWithSokosumiStatus> => {
    const { userId, agentId, inputData, inputSchema } = input;
    const activeOrganizationId = await userService.getActiveOrganizationId();

    const agent = await agentService.getAvailableAgentById(agentId);
    if (!agent) {
      throw new JobError(JobErrorCode.AGENT_NOT_FOUND, "Agent not found");
    }

    const workspace = await resolveWorkspaceForContext(
      userId,
      activeOrganizationId,
      prisma,
    );

    const job = await jobRepository.createDemoJob(
      {
        jobType: JobType.DEMO,
        agentJobId: uuidv4(),
        agentId,
        userId,
        organizationId: activeOrganizationId,
        workspaceId: workspace.id,
        input: JSON.stringify(inputData),
        inputSchema: inputSchema,
        name: "Demo Job",
        result: jobStatusResponse.result,
      },
      prisma,
    );

    // Enqueue any sources from demo output
    try {
      // Find the COMPLETED event with a result for the demo job
      const eventWithResult = job.events.find(
        (event) =>
          event.status === AgentJobStatus.COMPLETED && event.result !== null,
      );
      if (eventWithResult?.result) {
        await sourceImportService.enqueueFromMarkdown(
          eventWithResult.id,
          eventWithResult.result,
        );
      }
    } catch {
      // Ignore errors
    }

    return job;
  };

  /**
   * Internal helper: Starts a PAID job with full blockchain/payment flow.
   */
  async function startPaidJobInternal(
    input: StartJobInputSchemaType,
    agent: AgentWithRelations,
  ): Promise<JobWithSokosumiStatus> {
    const {
      userId,
      organizationId,
      agentId,
      maxAcceptedCents,
      inputData,
      inputSchema,
      jobScheduleId,
    } = input;

    // Add breadcrumb for paid job start
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Starting paid job service operation",
      level: "info",
      data: {
        agentId,
        userId,
        organizationId,
      },
    });

    // Get pricing and validate balance in single transaction
    const agentWithCreditsPrice = await prisma.$transaction(async (tx) => {
      // Get pricing for paid job
      const agentWithPrice = await agentService.getAgentCreditsPrice(agent, tx);

      // Validate cost not too high
      if (agentWithPrice.creditsPrice.cents > maxAcceptedCents) {
        Sentry.setTag("error_type", "cost_too_high");
        Sentry.setContext("cost_validation", {
          agentId,
          creditsCents: agentWithPrice.creditsPrice.cents,
          maxAcceptedCents,
          organizationId,
        });

        Sentry.captureMessage(
          `Credit cost too high: ${agentWithPrice.creditsPrice.cents} > ${maxAcceptedCents}`,
          "warning",
        );
        throw new JobError(
          JobErrorCode.COST_TOO_HIGH,
          "Credit cost is too high",
        );
      }

      // Add breadcrumb for credit validation
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Validating credit balance",
        level: "info",
        data: {
          creditsCents: agentWithPrice.creditsPrice.cents,
          organizationId,
        },
      });

      // Validate balance in same transaction
      if (agentWithPrice.creditsPrice.cents > 0) {
        try {
          await validateBalance(
            userId,
            organizationId ?? null,
            agentWithPrice.creditsPrice.cents,
            tx,
          );
        } catch (error) {
          try {
            await track("Insufficient balance", {
              userId,
              creditsCents: agentWithPrice.creditsPrice.cents.toString(),
              isOrganization: !!organizationId,
              ...(organizationId ? { organizationId } : {}),
            });
          } catch (trackingError) {
            console.error(
              "Failed to track insufficient balance",
              trackingError,
            );
          }
          throw error;
        }
      }

      // Add breadcrumb for successful validation
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Credit validation successful",
        level: "info",
        data: {
          creditsCents: agentWithPrice.creditsPrice.cents,
          organizationId,
        },
      });

      return agentWithPrice;
    });

    // Start job
    const identifierFromPurchaser = uuidv4().replace(/-/g, "").substring(0, 20);

    // Add breadcrumb for agent job start
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Starting agent job via external API",
      level: "info",
      data: {
        agentId,
        agentName: agentWithCreditsPrice.name,
        identifierFromPurchaser,
      },
    });

    const startJobResult = await agentClient.startPaidAgentJob(
      agentWithCreditsPrice,
      identifierFromPurchaser,
      inputData,
    );
    if (!startJobResult.isOk()) {
      Sentry.setTag("error_type", "agent_job_start_failed");
      Sentry.setContext("agent_job_start", {
        agentId,
        agentName: agentWithCreditsPrice.name,
        identifierFromPurchaser,
        error: startJobResult.error,
      });

      Sentry.captureMessage(
        `Agent job start failed: ${startJobResult.error}`,
        "error",
      );
      throw new JobError(
        JobErrorCode.AGENT_JOB_START_FAILED,
        startJobResult.error,
      );
    }
    const startJobResponse = startJobResult.value;
    // Add breadcrumb for successful agent job start
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Agent job started successfully",
      level: "info",
      data: {
        agentJobId: startJobResponse.id,
        blockchainIdentifier: startJobResponse.blockchainIdentifier,
      },
    });

    // Generate job name
    const generatedName = await generateJobNameForAgent(
      agentWithCreditsPrice,
      inputData,
    );

    // Create job, transaction, and consume credits in a single transaction
    // Add breadcrumb for job creation
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Creating job in database",
      level: "info",
      data: {
        agentJobId: startJobResponse.id,
        blockchainIdentifier: startJobResponse.blockchainIdentifier,
        generatedName: generatedName,
      },
    });

    // Create job, transaction, and consume credits in a single transaction
    const job = await prisma.$transaction(
      async (tx) => {
        const workspace = await resolveWorkspaceForContext(
          userId,
          organizationId,
          tx,
        );

        return await jobRepository.createJob(
          {
            jobType: JobType.PAID,
            agentJobId: startJobResponse.id,
            agentId,
            userId,
            organizationId,
            workspaceId: workspace.id,
            input: JSON.stringify(inputData),
            inputHash: startJobResponse.input_hash,
            inputSchema: inputSchema,
            creditsPrice: agentWithCreditsPrice.creditsPrice,
            identifierFromPurchaser,
            externalDisputeUnlockTime: new Date(
              startJobResponse.externalDisputeUnlockTime,
            ),
            payByTime: new Date(startJobResponse.payByTime),
            submitResultTime: new Date(startJobResponse.submitResultTime),
            unlockTime: new Date(startJobResponse.unlockTime),
            blockchainIdentifier: startJobResponse.blockchainIdentifier,
            sellerVkey: startJobResponse.sellerVKey,
            name: generatedName,
            jobScheduleId,
          },
          tx,
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    // Add breadcrumb for purchase creation
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Creating purchase record",
      level: "info",
      data: {
        jobId: job.id,
        blockchainIdentifier: startJobResponse.blockchainIdentifier,
      },
    });

    // Create purchase
    const createPurchaseResult = await paymentClient.createPurchase(
      agentWithCreditsPrice.blockchainIdentifier,
      startJobResponse,
      inputData,
      identifierFromPurchaser,
    );
    if (createPurchaseResult.isOk()) {
      const purchase = createPurchaseResult.value;
      const purchaseData = transformPurchaseToJobUpdate(purchase);
      await jobPurchaseRepository.createJobPurchase(
        {
          jobId: job.id,
          ...purchaseData,
        },
        prisma,
      );

      // Add breadcrumb for successful purchase creation
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Purchase created successfully",
        level: "info",
        data: {
          jobId: job.id,
          purchaseId: purchase.id,
        },
      });
    } else {
      Sentry.setTag("error_type", "purchase_creation_failed");
      Sentry.setContext("purchase_creation", {
        jobId: job.id,
        agentId,
        blockchainIdentifier: startJobResponse.blockchainIdentifier,
        error: createPurchaseResult.error,
      });

      Sentry.captureMessage(
        `Purchase creation failed: ${createPurchaseResult.error}`,
        "warning",
      );
    }

    await publishJobStatusSafely(job);

    // Add final success breadcrumb
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Job started successfully",
      level: "info",
      data: {
        jobId: job.id,
        agentJobId: startJobResponse.id,
        blockchainIdentifier: startJobResponse.blockchainIdentifier,
      },
    });

    return job;
  }

  /**
   * Internal helper: Starts a FREE job without payment/blockchain flow.
   */
  async function startFreeJobInternal(
    input: StartJobInputSchemaType,
    agent: AgentWithRelations,
  ): Promise<JobWithSokosumiStatus> {
    const {
      userId,
      organizationId,
      agentId,
      inputData,
      inputSchema,
      jobScheduleId,
    } = input;

    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Starting free agent job via external API",
      level: "info",
      data: {
        agentId,
        agentName: agent.name,
      },
    });

    // Start job with agent using free job client
    const startJobResult = await agentClient.startFreeAgentJob(
      agent,
      inputData,
    );

    if (startJobResult.isErr()) {
      Sentry.setTag("error_type", "agent_job_start_failed");
      Sentry.captureMessage(
        `Free agent job start failed: ${startJobResult.error}`,
        "error",
      );
      throw new JobError(
        JobErrorCode.AGENT_JOB_START_FAILED,
        startJobResult.error,
      );
    }

    const startJobResponse = startJobResult.value;

    // Generate job name
    const generatedName = await generateJobNameForAgent(agent, inputData);

    const workspace = await resolveWorkspaceForContext(
      userId,
      organizationId,
      prisma,
    );

    // Create free job in database
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Creating free job in database",
      level: "info",
      data: {
        agentJobId: startJobResponse.id,
        generatedName: generatedName,
      },
    });

    const job = await jobRepository.createJob(
      {
        jobType: JobType.FREE,
        agentJobId: startJobResponse.id,
        agentId,
        userId,
        organizationId,
        workspaceId: workspace.id,
        input: JSON.stringify(inputData),
        inputHash: null,
        inputSchema: inputSchema,
        name: generatedName,
        jobScheduleId,
      },
      prisma,
    );

    await publishJobStatusSafely(job);

    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Free job started successfully",
      level: "info",
      data: {
        jobId: job.id,
        agentJobId: startJobResponse.id,
      },
    });

    return job;
  }

  /**
   * Starts a new job for a specified agent with the provided input data.
   *
   * Automatically determines whether to use FREE or PAID workflow based on agent pricing.
   *
   * @param input - Job creation parameters
   * @returns Promise resolving to the created Job record
   * @throws {JobError} Various job-related errors
   */
  const startJob = async (
    input: StartJobInputSchemaType,
  ): Promise<JobWithSokosumiStatus> => {
    const { userId, organizationId, agentId } = input;

    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Starting job service operation",
      level: "info",
      data: { agentId, userId, organizationId },
    });

    // Get agent and determine pricing type
    const agent = await agentService.getAvailableAgentById(agentId);
    if (!agent) {
      Sentry.setTag("error_type", "agent_not_found");
      Sentry.captureMessage(
        `Agent not found during job start: ${agentId}`,
        "error",
      );
      throw new JobError(JobErrorCode.AGENT_NOT_FOUND, "Agent not found");
    }

    // Route to appropriate implementation based on pricing type
    switch (agent.pricing.pricingType) {
      case PricingType.FREE:
        Sentry.addBreadcrumb({
          category: "Job Service",
          message: "Routing to free job flow",
          level: "info",
        });
        return startFreeJobInternal(input, agent);

      case PricingType.FIXED:
        Sentry.addBreadcrumb({
          category: "Job Service",
          message: "Routing to paid job flow",
          level: "info",
        });

        return startPaidJobInternal(input, agent);

      case PricingType.UNKNOWN:
      default:
        Sentry.setTag("error_type", "unknown_pricing_type");
        Sentry.captureMessage(
          `Unknown pricing type for agent: ${agentId}`,
          "error",
        );
        throw new JobError(
          JobErrorCode.AGENT_PRICING_NOT_FOUND,
          "Agent has unknown pricing type",
        );
    }
  };

  /**
   * Requests a refund for a job based on its blockchain identifier.
   *
   * This function initiates a refund process for a job by contacting the payment service.
   * It updates the job's status to indicate that a refund has been requested.
   *
   * @param jobBlockchainIdentifier - The blockchain identifier of the job to refund.
   * @returns The updated job with status indicating the refund request.
   * @throws {JobError} If the refund request fails.
   */
  const requestRefund = async (
    jobBlockchainIdentifier: string,
  ): Promise<PaidJobWithStatus> => {
    // Add breadcrumb for refund request
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Requesting job refund",
      level: "info",
      data: {
        blockchainIdentifier: jobBlockchainIdentifier,
      },
    });

    const refundResult = await paymentClient.requestRefund(
      jobBlockchainIdentifier,
    );
    if (refundResult.isErr()) {
      Sentry.setTag("error_type", "refund_request_failed");
      Sentry.setContext("refund_error", {
        blockchainIdentifier: jobBlockchainIdentifier,
        error: refundResult.error,
      });

      Sentry.captureException(refundResult.error);
      throw new JobError(JobErrorCode.REFUND_REQUEST_FAILED);
    }

    const job = await prisma.$transaction(async (tx) => {
      await jobPurchaseRepository.updateJobPurchaseByExternalId(
        jobBlockchainIdentifier,
        {
          nextAction: NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
        },
        tx,
      );

      const job = await jobRepository.getJobByBlockchainIdentifier(
        jobBlockchainIdentifier,
        tx,
      );
      if (!job) {
        throw new JobError(JobErrorCode.JOB_NOT_FOUND, "Job not found");
      }
      return job;
    });

    // Add breadcrumb for successful refund request
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Refund requested successfully",
      level: "info",
      data: {
        jobId: job.id,
        blockchainIdentifier: jobBlockchainIdentifier,
      },
    });

    if (!isPaidJob(job)) {
      throw new JobError(JobErrorCode.JOB_NOT_FOUND, "Job not found");
    }

    return job;
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

    return await Promise.all(
      agentIds.map(async (agentId) => {
        const latestJob =
          await jobRepository.getLatestJobByAgentIdUserIdAndOrganization(
            agentId,
            userId,
            activeOrganizationId,
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
    startJob,
    startDemoJob,
    moveJobToWorkspace,
    requestRefund,
    getJobStatusesDataForAgents,
    provideJobInput,
  };
})();
