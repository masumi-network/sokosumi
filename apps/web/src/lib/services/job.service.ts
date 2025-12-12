import "server-only";

import * as Sentry from "@sentry/nextjs";
import {
  AgentJobStatus,
  AgentWithRelations,
  JobInput,
  JobShare,
  JobType,
  JobWithSokosumiStatus,
  NextJobAction,
  OnChainJobStatus,
  PaidJobWithStatus,
  PricingType,
  Prisma,
  SokosumiJobStatus,
} from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import {
  computeJobStatus,
  getLatestJobStatus,
  isPaidJob,
} from "@sokosumi/database/helpers";
import {
  creditTransactionRepository,
  jobInputRepository,
  jobPurchaseRepository,
  jobRepository,
  jobShareRepository,
  jobStatusRepository,
} from "@sokosumi/database/repositories";
import { track } from "@vercel/analytics/server";
import { getTranslations } from "next-intl/server";
import { v4 as uuidv4 } from "uuid";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import publishJobStatusData from "@/lib/ably/publish";
import { type JobStatusData } from "@/lib/ably/schema";
import { JobError, JobErrorCode } from "@/lib/actions/errors/error-codes/job";
import { getAuthContext } from "@/lib/auth/utils";
import { agentClient, anthropicClient, paymentClient } from "@/lib/clients";
import {
  JobFailureNotificationEmailProps,
  reactJobFailureNotificationEmail,
} from "@/lib/email/job-failure-notification";
import { reactJobStatusEmail } from "@/lib/email/job-status";
import { postmarkClient } from "@/lib/email/postmark";
import { getAgentName } from "@/lib/helpers/agent";
import { getJobStatusData } from "@/lib/helpers/job";
import { JobInputData } from "@/lib/job-input";
import {
  JobStatusResponseSchemaType,
  ProvideJobInputSchemaType,
  StartJobInputSchemaType,
} from "@/lib/schemas";
import { Err } from "@/lib/ts-res";
import {
  jobStatusToAgentJobStatus,
  transformPurchaseToJobUpdate,
} from "@/lib/utils/job-transformers";

import { agentService } from "./agent.service";
import { sourceImportService } from "./source-import.service";
import { userService } from "./user.service";

const { POSTMARK_FROM_EMAIL } = getEnvSecrets();
const { NEXT_PUBLIC_SOKOSUMI_URL } = getEnvPublicConfig();

const finalJobStatuses = new Set<SokosumiJobStatus>([
  SokosumiJobStatus.COMPLETED,
  SokosumiJobStatus.FAILED,
  SokosumiJobStatus.PAYMENT_FAILED,
  SokosumiJobStatus.REFUND_RESOLVED,
  SokosumiJobStatus.DISPUTE_RESOLVED,
]);

const failedJobStatuses = new Set<SokosumiJobStatus>([
  SokosumiJobStatus.FAILED,
  SokosumiJobStatus.PAYMENT_FAILED,
]);

export const jobService = (() => {
  /**
   * Helper function to determine if agent status should be synchronized for a job.
   */
  function shouldSyncAgentStatus(job: JobWithSokosumiStatus): string | null {
    // Demo jobs never sync - they are self-contained
    if (job.jobType === JobType.DEMO) {
      return null;
    }
    if (job.refundedCreditTransactionId) {
      return null;
    }
    if (
      job.purchase?.onChainStatus === OnChainJobStatus.RESULT_SUBMITTED &&
      job.status === SokosumiJobStatus.COMPLETED
    ) {
      return null;
    }
    return job.agentJobId;
  }

  /**
   * Helper function to determine if Masumi payment status should be synchronized for a job.
   * Only PAID jobs require Masumi payment synchronization.
   */
  function shouldSyncMasumiStatus(job: JobWithSokosumiStatus): string | null {
    // Free and demo jobs never sync Masumi payment status
    if (job.jobType === JobType.FREE || job.jobType === JobType.DEMO) {
      return null;
    }
    if (job.refundedCreditTransactionId) {
      return null;
    }
    if (job.purchase === null) {
      return null;
    }
    return job.purchase.externalId;
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
    job: JobWithSokosumiStatus,
    jobStatus: SokosumiJobStatus,
  ) {
    if (job.jobType === JobType.DEMO || !job.user.notificationsOptIn) {
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
   * Extracts job failure notification data from a job.
   * This data structure is used for both webhook notifications and email notifications.
   */
  function extractJobFailureNotificationData(
    job: JobWithSokosumiStatus,
  ): JobFailureNotificationEmailProps {
    const latestStatus = getLatestJobStatus(job);
    return {
      network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
      agentId: job.agentId,
      agentBlockchainIdentifier: job.agent.blockchainIdentifier,
      agentName: job.agent.name,
      jobId: job.id,
      jobBlockchainIdentifier: job.blockchainIdentifier,
      onChainStatus: job.purchase?.onChainStatus ?? "N/A",
      agentStatus: job.status,
      result: latestStatus?.result ?? "N/A",
      resultHash: job.purchase?.resultHash ?? "N/A",
    };
  }

  async function dispatchJobFailureNotification(job: JobWithSokosumiStatus) {
    // Skip demo jobs
    if (job.jobType === JobType.DEMO) {
      return;
    }

    try {
      // Extract notification data for webhook
      const notificationData = extractJobFailureNotificationData(job);

      // Send webhook notification
      const { JOB_FAILURE_WEBHOOK_URL } = getEnvSecrets();
      if (JOB_FAILURE_WEBHOOK_URL) {
        const request = new Request(JOB_FAILURE_WEBHOOK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(notificationData),
        });
        fetch(request).catch((webhookError) => {
          Sentry.captureException(webhookError, {
            contexts: {
              error_classification: {
                severity: "error",
                domain: "job_failure_notification",
                category: "webhook",
              },
            },
            extra: {
              jobId: job.id,
            },
          });
        });
      }

      // Send email notification
      const { JOB_FAILURE_NOTIFICATION_EMAILS } = getEnvSecrets();

      // Get stakeholder emails from environment
      const stakeholderEmails = JOB_FAILURE_NOTIFICATION_EMAILS.filter(
        (email) => email.trim() !== "",
      );

      // Get agent's author contact email
      const authorContactEmail = job.agent.authorContactEmail?.trim();

      // Determine To and Bcc based on authorContactEmail presence
      let toRecipients: string[];
      let bccRecipients: string[] | undefined;

      if (authorContactEmail) {
        // If author email exists: author as To, stakeholders as Bcc
        toRecipients = [authorContactEmail];
        bccRecipients =
          stakeholderEmails.length > 0 ? stakeholderEmails : undefined;
      } else {
        // If no author email: stakeholders as To
        toRecipients = stakeholderEmails;
        bccRecipients = undefined;
      }

      if (toRecipients.length === 0) return;

      // Generate email content (subject and body)
      const { subject, htmlBody } =
        await reactJobFailureNotificationEmail(notificationData);

      // Send email with appropriate To and Bcc recipients
      postmarkClient
        .sendEmail({
          From: POSTMARK_FROM_EMAIL,
          To: toRecipients.join(","),
          ...(bccRecipients && { Bcc: bccRecipients.join(",") }),
          Tag: "job-failure-notification",
          Subject: subject,
          HtmlBody: htmlBody,
          MessageStream: "outbound",
        })
        .catch((emailError) => {
          Sentry.captureException(emailError, {
            contexts: {
              error_classification: {
                severity: "error",
                domain: "job_failure_notification",
                category: "email",
              },
            },
            extra: {
              jobId: job.id,
              userId: job.userId,
              agentId: job.agentId,
            },
          });
        });
    } catch (error) {
      Sentry.captureException(error, {
        contexts: {
          error_classification: {
            severity: "error",
            domain: "job_failure_notification",
            category: "service_layer",
          },
        },
        extra: {
          jobId: job.id,
          userId: job.userId,
          agentId: job.agentId,
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
   * Generates a job name using AI based on agent information and input data.
   * Returns null if generation fails.
   *
   * @param agent - Agent with name and description
   * @param inputData - Input data for the job
   * @returns Generated job name or null if generation fails
   */
  async function generateJobNameForAgent(
    agent: { name: string; description: string | null },
    inputData: JobInputData,
  ): Promise<string | null> {
    try {
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Generating job name via AI",
        level: "info",
        data: { agentName: agent.name },
      });

      return await anthropicClient.generateJobName(
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

    const job = await jobRepository.createDemoJob({
      jobType: JobType.DEMO,
      agentJobId: uuidv4(),
      agentId,
      userId,
      organizationId: activeOrganizationId,
      input: JSON.stringify(inputData),
      inputSchema: inputSchema,
      name: "Demo Job",
      result: jobStatusResponse.result,
    });

    // Enqueue any sources from demo output
    try {
      // Find the COMPLETED event with a result for the demo job
      const eventWithResult = job.statuses.find(
        (status) =>
          status.status === AgentJobStatus.COMPLETED && status.result !== null,
      );
      if (eventWithResult?.result) {
        await sourceImportService.enqueueFromMarkdown(
          userId,
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
          if (organizationId) {
            await validateOrganizationCreditsBalance(
              organizationId,
              agentWithPrice.creditsPrice.cents,
              tx,
            );
          } else {
            await validateUserCreditsBalance(
              userId,
              agentWithPrice.creditsPrice.cents,
              tx,
            );
          }
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
        agentJobId: startJobResponse.id,
        blockchainIdentifier: startJobResponse.blockchainIdentifier,
      },
    });

    // Generate job name
    const generatedName = await generateJobNameForAgent(
      agentWithCreditsPrice,
      inputData,
    );

    // Create job
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

    const job = await jobRepository.createJob({
      jobType: JobType.PAID,
      agentJobId: startJobResponse.id,
      agentId,
      userId,
      organizationId,
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
      const purchaseData = transformPurchaseToJobUpdate(purchase);
      await jobPurchaseRepository.createJobPurchase({
        jobId: job.id,
        ...purchaseData,
      });

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

    if (!startJobResult.ok) {
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

    const startJobResponse = startJobResult.data;

    // Generate job name
    const generatedName = await generateJobNameForAgent(agent, inputData);

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

    const job = await jobRepository.createJob({
      jobType: JobType.FREE,
      agentJobId: startJobResponse.id,
      agentId,
      userId,
      organizationId,
      input: JSON.stringify(inputData),
      inputHash: null,
      inputSchema: inputSchema,
      name: generatedName,
      jobScheduleId,
    });

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
  const syncJob = async (initialJob: JobWithSokosumiStatus): Promise<void> => {
    const oldJobStatus = computeJobStatus(initialJob);
    let job: JobWithSokosumiStatus | null = initialJob;
    if (isPaidJob(job) && job.purchase === null) {
      const purchaseResult =
        await paymentClient.getPurchaseByBlockchainIdentifier(
          job.blockchainIdentifier,
        );
      if (purchaseResult.ok) {
        const purchaseData = transformPurchaseToJobUpdate(purchaseResult.data);
        await jobPurchaseRepository.createJobPurchase({
          jobId: job.id,
          ...purchaseData,
        });
      }
      job = await jobRepository.getJobById(job.id);
    }
    if (!job) {
      throw new JobError(JobErrorCode.JOB_NOT_FOUND, "Job not found");
    }
    const agentJobIdToSync = shouldSyncAgentStatus(job);
    const purchaseIdToSync = shouldSyncMasumiStatus(job);

    const [agentJobStatusResult, onChainPurchaseResult] = await Promise.all([
      agentJobIdToSync
        ? await agentClient.fetchAgentJobStatus(job.agent, agentJobIdToSync)
        : Promise.resolve(Err("No agent job ID to sync")),
      purchaseIdToSync
        ? await paymentClient.getPurchaseById(purchaseIdToSync)
        : Promise.resolve(Err("No purchase ID to sync")),
    ]);

    const newJobStatus = await prisma.$transaction(
      async (tx) => {
        if (!job) {
          throw new JobError(JobErrorCode.JOB_NOT_FOUND, "Job not found");
        }
        if (onChainPurchaseResult.ok) {
          const purchaseData = transformPurchaseToJobUpdate(
            onChainPurchaseResult.data,
          );
          await jobPurchaseRepository.updateJobPurchaseByJobId(
            job.id,
            purchaseData,
            tx,
          );
        }
        if (agentJobStatusResult.ok) {
          const agentJobStatus = jobStatusToAgentJobStatus(
            agentJobStatusResult.data.status,
          );
          const latestJobStatus =
            await jobStatusRepository.getLatestJobStatusByJobId(job.id, tx);

          if (latestJobStatus) {
            // If the latest job status is the same as the agent job status result, return the current job status
            if (latestJobStatus.externalId === agentJobStatusResult.data.id) {
              return computeJobStatus(job);
            } else {
              // If the agent job status result has no external ID, check if the latest job status status is the same as the agent job status
              if (!agentJobStatusResult.data.id) {
                if (latestJobStatus.status === agentJobStatus) {
                  return computeJobStatus(job);
                }
              }
            }
          }

          const inputSchemaData = agentJobStatusResult.data.input_schema;
          let inputSchemaValue: string | undefined;
          if (inputSchemaData) {
            if ("input_data" in inputSchemaData) {
              inputSchemaValue = JSON.stringify(inputSchemaData.input_data);
            } else {
              inputSchemaValue = JSON.stringify(inputSchemaData.input_groups);
            }
          } else {
            inputSchemaValue = undefined;
          }

          const newJobStatus =
            await jobStatusRepository.createJobStatusForJobId(
              job.id,
              {
                externalId: agentJobStatusResult.data.id,
                status: agentJobStatus,
                inputSchema: inputSchemaValue,
                result: agentJobStatusResult.data.result,
              },
              tx,
            );
          job = await jobRepository.getJobById(job.id, tx);
          if (!job) {
            throw new JobError(JobErrorCode.JOB_NOT_FOUND, "Job not found");
          }

          // Fire and forget: enqueue extraction if output is present
          try {
            const outputResult = agentJobStatusResult.data?.result;
            if (typeof outputResult === "string") {
              sourceImportService
                .enqueueFromMarkdown(job.userId, newJobStatus.id, outputResult)
                .catch(() => {
                  // Ignore errors
                });
            }
          } catch {
            // Ignore errors
          }
        }
        const jobStatus = computeJobStatus(job);
        switch (jobStatus) {
          case SokosumiJobStatus.PAYMENT_FAILED:
          case SokosumiJobStatus.REFUND_RESOLVED:
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

      // Send failure notification for FAILED or PAYMENT_FAILED statuses
      if (failedJobStatuses.has(newJobStatus)) {
        await dispatchJobFailureNotification(job);
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
  const getJobStatusesDataForAgents = async (
    agentIds: string[],
    tx: Prisma.TransactionClient = prisma,
  ): Promise<(JobStatusData | null)[]> => {
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
        return getJobStatusData(latestJob);
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
  ): Promise<{ job: JobWithSokosumiStatus; share: JobShare } | null> => {
    return await prisma.$transaction(async (tx) => {
      const share = await jobShareRepository.getShareByToken(token, tx);
      if (!share) {
        return null;
      }

      const job = await jobRepository.getJobById(share.jobId, tx);
      if (!job) {
        return null;
      }

      return { job, share };
    });
  };

  /**
   * Provides input for a job that is awaiting input (human-in-the-loop).
   *
   * This function:
   * - Validates the job exists and user owns it
   * - Validates the JobStatus (by statusId/externalId) is in awaiting input state
   * - Stores the provided input data
   * - Calls the agent API to provide input
   * - Updates the existing JobStatus with input data and new status
   *
   * @param input - Parameters including jobId, statusId (maps to externalId), userId, and inputData
   * @returns Promise resolving to the updated Job record
   * @throws {JobError} Various job-related errors
   */
  const provideJobInput = async (
    input: ProvideJobInputSchemaType & { userId: string },
  ): Promise<{ job: JobWithSokosumiStatus; input: JobInput }> => {
    const { jobId, statusId, userId, inputData } = input;

    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Providing job input",
      level: "info",
      data: {
        jobId,
        statusId,
        userId,
      },
    });

    // Get the job and verify ownership
    const job = await jobRepository.getJobById(jobId);
    if (!job || job.userId !== userId) {
      throw new JobError(JobErrorCode.JOB_NOT_FOUND, "Job not found");
    }
    // Get the JobStatus by externalId (statusId) that is awaiting input
    const jobStatus =
      await jobStatusRepository.getAwaitingInputJobStatusByJobIdAndExternalId(
        jobId,
        statusId,
      );
    if (!jobStatus) {
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
        statusId,
        jobStatusId: jobStatus.id,
        agentId: job.agentId,
        agentJobId: job.agentJobId,
      },
    });

    // Call agent API to provide input
    const provideInputResult = await agentClient.provideJobInput(
      job.agent,
      statusId,
      job.agentJobId,
      inputData,
    );

    if (!provideInputResult.ok) {
      Sentry.setTag("error_type", "agent_provide_input_failed");
      Sentry.setContext("agent_provide_input", {
        jobId: job.id,
        statusId,
        jobStatusId: jobStatus.id,
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

    const responseData = provideInputResult.data;

    const { job: updatedJob, input: jobInput } = await prisma.$transaction(
      async (tx) => {
        const jobInput = await jobInputRepository.createJobInputForJobStatusId(
          jobStatus.id,
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

        return { job: updatedJob, input: jobInput };
      },
    );

    // Publish job status update
    await publishJobStatusSafely(updatedJob);

    Sentry.addBreadcrumb({
      category: "Job Service",
      message: "Job input provided successfully",
      level: "info",
      data: {
        jobId: updatedJob.id,
        statusId,
        jobStatusId: jobStatus.id,
      },
    });

    return { job: updatedJob, input: jobInput };
  };

  return {
    startJob,
    startDemoJob,
    requestRefund,
    syncJob,
    getJobStatusesDataForAgents,
    getPubliclySharedJob,
    provideJobInput,
  };
})();
