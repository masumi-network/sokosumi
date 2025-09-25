import "server-only";

import * as Sentry from "@sentry/nextjs";
import { getTranslations } from "next-intl/server";
import { v4 as uuidv4 } from "uuid";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import publishJobStatusData from "@/lib/ably/publish";
import { JobIndicatorStatus } from "@/lib/ably/schema";
import { JobError, JobErrorCode } from "@/lib/actions/errors/error-codes/job";
import { getAuthContext } from "@/lib/auth/utils";
import { agentClient, anthropicClient, paymentClient } from "@/lib/clients";
import {
  computeJobStatus,
  getAgentName,
  getJobIndicatorStatus,
  JobStatus,
  jobStatusToAgentJobStatus,
  JobWithStatus,
} from "@/lib/db";
import {
  creditTransactionRepository,
  jobRepository,
  jobShareRepository,
  prisma,
} from "@/lib/db/repositories";
import { reactJobStatusEmail } from "@/lib/email/job-status";
import { postmarkClient } from "@/lib/email/postmark";
import {
  JobStatusResponseSchemaType,
  PricingAmountsSchemaType,
  StartJobInputSchemaType,
} from "@/lib/schemas";
import { getInputHash, getOutputHash } from "@/lib/utils";
import {
  AgentJobStatus,
  Job,
  JobShare,
  NextJobAction,
  OnChainJobStatus,
  Prisma,
  ShareAccessType,
  SharePermission,
} from "@/prisma/generated/client";

import { agentService } from "./agent.service";
import { sourceImportService } from "./source-import.service";
import { userService } from "./user.service";

const { POSTMARK_FROM_EMAIL } = getEnvSecrets();
const { NEXT_PUBLIC_SOKOSUMI_URL } = getEnvPublicConfig();

const finalJobStatuses = new Set<JobStatus>([
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.PAYMENT_FAILED,
  JobStatus.REFUND_RESOLVED,
  JobStatus.DISPUTE_RESOLVED,
]);

export const jobService = (() => {
  /**
   * Helper function to determine if agent status should be synchronized for a job.
   */
  function shouldSyncAgentStatus(job: Job): boolean {
    if (job.refundedCreditTransactionId) {
      return false;
    }
    if (
      job.onChainStatus === OnChainJobStatus.RESULT_SUBMITTED &&
      job.agentJobStatus === AgentJobStatus.COMPLETED
    ) {
      return false;
    }
    return true;
  }

  /**
   * Helper function to determine if Masumi payment status should be synchronized for a job.
   */
  function shouldSyncMasumiStatus(job: Job): boolean {
    return job.refundedCreditTransactionId === null;
  }

  /**
   * Validates that the agent's pricing schema matches the job's pricing schema.
   *
   * - Compares the pricing amounts (unit and amount) between the agent and the job.
   * - Throws a JobError with code PRICING_SCHEMA_MISMATCH if:
   *   - The number of pricing units differs.
   *   - Any unit in the job's pricing is missing from the agent's pricing.
   *   - The amount for any unit does not match between agent and job.
   *
   * @param agentPricing - The pricing amounts defined by the agent.
   * @param jobPricing - The pricing amounts specified for the job.
   * @throws {JobError} If the pricing schemas do not match.
   */
  function tryValidatePricing(
    agentPricing: PricingAmountsSchemaType,
    jobPricing: PricingAmountsSchemaType,
  ): void {
    const agentPricingMap = new Map(
      agentPricing.map((amount) => [amount.unit, amount.amount]),
    );
    const jobPricingMap = new Map(
      jobPricing.map((amount) => [amount.unit, amount.amount]),
    );
    if (agentPricingMap.size !== jobPricingMap.size) {
      throw new JobError(
        JobErrorCode.PRICING_SCHEMA_MISMATCH,
        "Pricing schemas have different lengths",
      );
    }
    // verify that the pricing schemas are identical
    for (const [unit, amount] of jobPricingMap) {
      if (!agentPricingMap.has(unit)) {
        throw new JobError(
          JobErrorCode.PRICING_SCHEMA_MISMATCH,
          `Agent pricing not found for unit ${unit}`,
        );
      }
      if (agentPricingMap.get(unit) !== amount) {
        throw new JobError(
          JobErrorCode.PRICING_SCHEMA_MISMATCH,
          `Agent pricing for unit ${unit} is incorrect`,
        );
      }
    }
  }
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
  const validateUserCreditsBalance = async (
    userId: string,
    cents: bigint,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> => {
    const centsBalance = await creditTransactionRepository.getCentsByUserId(
      userId,
      tx,
    );
    if (centsBalance - cents < BigInt(0)) {
      throw new JobError(
        JobErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance",
      );
    }
  };

  async function dispatchFinalStatusNotification(
    job: JobWithStatus,
    jobStatus: JobStatus,
  ) {
    if (job.isDemo || !job.user.jobStatusEmailNotificationsEnabled) {
      return;
    }

    try {
      const t = await getTranslations({
        locale: "en",
        namespace: "Library.Email.JobStatus",
      });

      const agentName = getAgentName(job.agent);
      const jobLink = `${NEXT_PUBLIC_SOKOSUMI_URL}/agents/${job.agentId}/jobs/${job.id}`;
      const statusLabel = t(`status.${jobStatus}`);

      const htmlBody = await reactJobStatusEmail({
        recipientName: job.user.name,
        agentName,
        jobName: job.name,
        jobStatus,
        jobLink,
      });

      postmarkClient.sendEmail({
        From: POSTMARK_FROM_EMAIL,
        To: job.user.email,
        Tag: "job-final-status",
        Subject: t("subject", { agentName, status: statusLabel }),
        HtmlBody: htmlBody,
        MessageStream: "outbound",
      });
    } catch (error) {
      Sentry.captureException(error, {
        contexts: {
          error_classification: {
            severity: "error",
            domain: "job_status_notification",
            category: "service_layer",
          },
        },
        extra: {
          jobId: job.id,
          jobStatus,
          userId: job.userId,
        },
      });
    }
  }

  /**
   * Validates that an organization has sufficient credit balance (in cents) to cover a specified amount.
   *
   * This function retrieves the organization's current credit balance in cents and checks if it is
   * greater than or equal to the required amount. If the balance is insufficient, it throws an error.
   *
   * @param organizationId - The ID of the organization whose balance is being validated.
   * @param cents - The amount (in cents) to validate against the organization's balance.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @throws Error if the organization's balance is insufficient to cover the specified amount.
   */
  const validateOrganizationCreditsBalance = async (
    organizationId: string,
    cents: bigint,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> => {
    const centsBalance =
      await creditTransactionRepository.getCentsByOrganizationId(
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
  ): Promise<Job> => {
    const { userId, agentId, inputData, inputSchema } = input;
    const activeOrganizationId = await userService.getActiveOrganizationId();

    const agent = await agentService.getAvailableAgentById(agentId);
    if (!agent) {
      throw new JobError(JobErrorCode.AGENT_NOT_FOUND, "Agent not found");
    }

    const output = JSON.stringify(jobStatusResponse);
    const agentJobStatus = jobStatusToAgentJobStatus(jobStatusResponse.status);

    // Generate identifier and hashes for demo parity
    const identifierFromPurchaser = uuidv4().replace(/-/g, "").substring(0, 20);
    const inputHash = getInputHash(inputData, identifierFromPurchaser);
    const outputHash = getOutputHash(
      jobStatusResponse,
      identifierFromPurchaser,
    );

    const job = await jobRepository.createDemoJob({
      agentJobId: uuidv4(),
      agentId,
      userId,
      organizationId: activeOrganizationId,
      input: JSON.stringify(Object.fromEntries(inputData)),
      inputSchema: inputSchema,
      name: "Demo Job",
      agentJobStatus,
      output,
      identifierFromPurchaser,
      inputHash,
      outputHash,
      completedAt:
        agentJobStatus === AgentJobStatus.COMPLETED ? new Date() : null,
    });

    // Enqueue any sources from demo output
    try {
      if (job.output) {
        const parsedOutput = JSON.parse(job.output);
        if (parsedOutput?.result && typeof parsedOutput.result === "string") {
          await sourceImportService.enqueueFromMarkdown(
            userId,
            job.id,
            parsedOutput.result,
          );
        }
      }
    } catch {}

    return job;
  };

  /**
   * Starts a new job for a specified agent with the provided input data.
   *
   * This function handles the complete job creation workflow including:
   * - Agent validation and availability checks
   * - Credit cost validation and balance verification
   * - External agent job initiation
   * - Database job record creation
   * - Purchase record creation through payment service
   * - Job name generation via Anthropic AI
   *
   * @param input - Job creation parameters including agent ID, user ID, input data, and pricing constraints
   * @returns Promise resolving to the created Job record
   * @throws {JobError} Various job-related errors including agent not found, insufficient balance, etc.
   */
  const startJob = async (input: StartJobInputSchemaType): Promise<Job> => {
    const {
      userId,
      organizationId,
      agentId,
      maxAcceptedCents,
      inputData,
      inputSchema,
    } = input;

    // Add breadcrumb for job start
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Starting job service operation",
      level: "info",
      data: {
        agentId,
        userId,
        organizationId,
      },
    });

    const agentWithCreditsPrice = await prisma.$transaction(async (tx) => {
      // Add breadcrumb for database transaction
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Starting database transaction for job validation",
        level: "info",
        data: { agentId },
      });

      const agent = await agentService.getAvailableAgentById(agentId, tx);
      if (!agent) {
        Sentry.setTag("error_type", "agent_not_found");
        Sentry.setContext("agent_validation", {
          agentId,
          userId,
          organizationId,
        });

        Sentry.captureMessage(
          `Agent not found during job start: ${agentId}`,
          "error",
        );
        throw new JobError(JobErrorCode.AGENT_NOT_FOUND, "Agent not found");
      }

      // Add breadcrumb for successful agent retrieval
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Agent retrieved successfully",
        level: "info",
        data: {
          agentId,
          agentName: agent.name,
          blockchainIdentifier: agent.blockchainIdentifier,
        },
      });

      const agentWithCreditsPrice = await agentService.getAgentCreditsPrice(
        agent,
        tx,
      );

      if (agentWithCreditsPrice.creditsPrice.cents > maxAcceptedCents) {
        Sentry.setTag("error_type", "cost_too_high");
        Sentry.setContext("cost_validation", {
          agentId,
          creditsCents: agentWithCreditsPrice.creditsPrice.cents,
          maxAcceptedCents,
          organizationId,
        });

        Sentry.captureMessage(
          `Credit cost too high: ${agentWithCreditsPrice.creditsPrice.cents} > ${maxAcceptedCents}`,
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
          creditsCents: agentWithCreditsPrice.creditsPrice.cents,
          organizationId,
        },
      });

      if (agentWithCreditsPrice.creditsPrice.cents > 0) {
        try {
          if (organizationId) {
            await validateOrganizationCreditsBalance(
              organizationId,
              agentWithCreditsPrice.creditsPrice.cents,
              tx,
            );
          } else {
            await validateUserCreditsBalance(
              userId,
              agentWithCreditsPrice.creditsPrice.cents,
              tx,
            );
          }
        } catch (error) {
          Sentry.setTag("error_type", "insufficient_balance");
          Sentry.setContext("balance_validation", {
            userId,
            organizationId,
            creditsCents: agentWithCreditsPrice.creditsPrice.cents,
            isOrganization: !!organizationId,
          });
          throw error;
        }
      }

      // Add breadcrumb for successful validation
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Credit validation successful",
        level: "info",
        data: {
          creditsCents: agentWithCreditsPrice.creditsPrice.cents,
          organizationId,
        },
      });

      return agentWithCreditsPrice;
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

    const startJobResult = await agentClient.startAgentJob(
      agentWithCreditsPrice,
      identifierFromPurchaser,
      inputData,
    );
    if (!startJobResult.ok) {
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
    const startJobResponse = startJobResult.data;
    // Add breadcrumb for successful agent job start
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Agent job started successfully",
      level: "info",
      data: {
        agentJobId: startJobResponse.job_id,
        blockchainIdentifier: startJobResponse.blockchainIdentifier,
      },
    });

    // Check if amounts are correct
    const jobAmountsPrice: PricingAmountsSchemaType =
      startJobResponse.amounts.map((amount) => ({
        unit: amount.unit,
        amount: Number(amount.amount),
      }));

    // Add breadcrumb for pricing validation
    const amountsPrice =
      agentWithCreditsPrice.pricing?.fixedPricing?.amounts.map((amount) => ({
        unit: amount.unit,
        amount: Number(amount.amount),
      })) ?? [];
    try {
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Validating pricing schema",
        level: "info",
        data: {
          agentAmountsCount: amountsPrice.length,
          jobAmountsCount: jobAmountsPrice.length,
        },
      });
      tryValidatePricing(amountsPrice, jobAmountsPrice);
    } catch (error) {
      Sentry.setTag("error_type", "pricing_schema_mismatch");
      Sentry.setContext("pricing_validation", {
        agentId,
        agentAmounts: amountsPrice,
        jobAmounts: jobAmountsPrice,
        agentJobId: startJobResponse.job_id,
      });
      throw error;
    }

    // Generate job name
    let generatedName: string | null;
    try {
      // Add breadcrumb for job name generation
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Generating job name via AI",
        level: "info",
        data: {
          agentName: agentWithCreditsPrice.name,
        },
      });

      generatedName = await anthropicClient.generateJobName(
        {
          name: agentWithCreditsPrice.name,
          description: agentWithCreditsPrice.description,
        },
        inputData,
      );
    } catch (error) {
      Sentry.withScope((scope) => {
        scope.setTag("error_type", "job_name_generation_failed");
        scope.setContext("job_name_generation", {
          agentId,
          agentName: agentWithCreditsPrice.name,
          agentDescription: agentWithCreditsPrice.description,
        });

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
      generatedName = null;
    }

    // Create job
    // Add breadcrumb for job creation
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Creating job in database",
      level: "info",
      data: {
        agentJobId: startJobResponse.job_id,
        blockchainIdentifier: startJobResponse.blockchainIdentifier,
        generatedName: generatedName,
      },
    });

    const job = await jobRepository.createJob({
      agentJobId: startJobResponse.job_id,
      agentId,
      userId,
      organizationId,
      input: JSON.stringify(Object.fromEntries(inputData)),
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
    });

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
    if (createPurchaseResult.ok) {
      const purchase = createPurchaseResult.data;
      await jobRepository.updateJobWithPurchase(job.id, purchase);

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

    try {
      await publishJobStatusData(job);
    } catch (err) {
      console.error("Error publishing job status data after creating job", err);
    }

    // Add final success breadcrumb
    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Job started successfully",
      level: "info",
      data: {
        jobId: job.id,
        agentJobId: startJobResponse.job_id,
        blockchainIdentifier: startJobResponse.blockchainIdentifier,
      },
    });

    return job;
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
  ): Promise<JobWithStatus> => {
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
    if (!refundResult.ok) {
      Sentry.setTag("error_type", "refund_request_failed");
      Sentry.setContext("refund_error", {
        blockchainIdentifier: jobBlockchainIdentifier,
        error: refundResult.error,
      });

      Sentry.captureMessage(
        `Refund request failed: ${refundResult.error}`,
        "error",
      );
      throw new JobError(
        JobErrorCode.REFUND_REQUEST_FAILED,
        refundResult.error,
      );
    }

    const job = await jobRepository.updateJobNextActionByBlockchainIdentifier(
      jobBlockchainIdentifier,
      NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
    );

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

    return job;
  };

  /**
   * Synchronizes a job's status by fetching updates from external services.
   *
   * This function updates job status by:
   * - Fetching agent job status if needed
   * - Retrieving on-chain purchase status
   * - Updating database records with new status
   * - Publishing status changes to job status channels
   *
   * @param job - The job to synchronize with current status
   */
  const syncJob = async (job: JobWithStatus): Promise<void> => {
    const oldJobStatus = computeJobStatus(job);
    if (!job.purchaseId) {
      const purchaseResult =
        await paymentClient.getPurchaseByBlockchainIdentifier(
          job.blockchainIdentifier,
        );
      if (purchaseResult.ok) {
        job = await jobRepository.updateJobWithPurchase(
          job.id,
          purchaseResult.data,
        );
      }
    }
    const [agentJobStatusResult, onChainPurchaseResult] = await Promise.all([
      shouldSyncAgentStatus(job)
        ? await agentClient.fetchAgentJobStatus(job.agent, job.agentJobId)
        : null,
      shouldSyncMasumiStatus(job)
        ? await paymentClient.getPurchaseById(job.purchaseId!)
        : null,
    ]);

    const newJobStatus = await prisma.$transaction(
      async (tx) => {
        if (onChainPurchaseResult && onChainPurchaseResult.ok) {
          job = await jobRepository.updateJobWithPurchase(
            job.id,
            onChainPurchaseResult.data,
            tx,
          );
        }
        if (agentJobStatusResult && agentJobStatusResult.ok) {
          job = await jobRepository.updateJobWithAgentJobStatus(
            job,
            agentJobStatusResult.data,
            tx,
          );
          // Fire and forget: enqueue extraction if output is present
          try {
            const output = agentJobStatusResult.data?.result;
            if (typeof output === "string") {
              sourceImportService
                .enqueueFromMarkdown(job.userId, job.id, output)
                .catch(() => {});
            }
          } catch {}
        }
        const jobStatus = computeJobStatus(job);
        switch (jobStatus) {
          case JobStatus.PAYMENT_FAILED:
          case JobStatus.REFUND_RESOLVED:
            await jobRepository.refundJob(job.id, tx);
            break;
          default:
            break;
        }
        return jobStatus;
      },
      {
        maxWait: 5000, // default: 2000
        timeout: 20000, // default: 5000
      },
    );

    // if job status changed, publish to job status to channel
    if (newJobStatus !== oldJobStatus) {
      console.log(
        `Job ${job.id} status changed from ${oldJobStatus} to ${newJobStatus}`,
      );

      if (finalJobStatuses.has(newJobStatus)) {
        await dispatchFinalStatusNotification(job, newJobStatus);
      }

      try {
        await publishJobStatusData(job);
      } catch (err) {
        console.error("Error publishing job status data", err);
      }
    }
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
  const getJobIndicatorStatuses = async (
    agentIds: string[],
    tx: Prisma.TransactionClient = prisma,
  ): Promise<(JobIndicatorStatus | null)[]> => {
    const context = await getAuthContext();
    if (!context) {
      return [];
    }
    const userId = context.userId;
    const activeOrganizationId = context.organizationId;

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
        return getJobIndicatorStatus(latestJob);
      }),
    );
  };

  /**
   * Retrieves a job that is publicly shared by a token.
   *
   * @param token - The token of the job share to get the job for.
   * @returns The job that is publicly shared by the token, or null if not found or not accessible.
   */
  const getPubliclySharedJob = async (
    token: string,
  ): Promise<{ job: JobWithStatus; share: JobShare } | null> => {
    const share = await jobShareRepository.getJobShareByToken(token);
    if (!share) {
      return null;
    }

    // must have Public Access and Read Permission
    if (
      share.accessType !== ShareAccessType.PUBLIC ||
      share.permission !== SharePermission.READ
    ) {
      return null;
    }

    const job = await jobRepository.getJobById(share.jobId);
    if (!job) {
      return null;
    }

    return { job, share };
  };

  return {
    startJob,
    startDemoJob,
    requestRefund,
    syncJob,
    getJobIndicatorStatuses,
    getPubliclySharedJob,
  };
})();
