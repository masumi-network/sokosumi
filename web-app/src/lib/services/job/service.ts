import "server-only";

import * as Sentry from "@sentry/nextjs";
import { v4 as uuidv4 } from "uuid";

import { getEnvPublicConfig } from "@/config/env.public";
import { JobStatusData } from "@/lib/ably";
import publishJobStatusData from "@/lib/ably/publish";
import { JobError, JobErrorCode } from "@/lib/actions/types/error-codes/job";
import { postPurchaseResolveBlockchainIdentifier } from "@/lib/api/generated/payment";
import { getPaymentClient } from "@/lib/api/payment-service.client";
import { getActiveOrganizationId, getSessionOrThrow } from "@/lib/auth/utils";
import {
  computeJobStatus,
  getJobStatusData,
  JobStatus,
  JobWithStatus,
} from "@/lib/db";
import {
  agentRepository,
  creditTransactionRepository,
  jobRepository,
  prisma,
} from "@/lib/db/repositories";
import { generateJobName } from "@/lib/generateJobName";
import { JobInputData } from "@/lib/job-input";
import {
  PricingAmountsSchemaType,
  StartJobInputSchemaType,
} from "@/lib/schemas";
import { getAvailableAgentById } from "@/lib/services";
import { getInputHash, getInputHashDeprecated } from "@/lib/utils";
import {
  AgentJobStatus,
  Job,
  NextJobAction,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";
import { getCreditsPrice } from "@/services/credit";

import {
  createPurchase,
  fetchAgentJobStatus,
  getPaymentClientPurchase,
  postPaymentClientRequestRefund,
  startAgentJob,
} from "./third-party";

function getMatchedInputHash(
  inputData: JobInputData,
  identifierFromPurchaser: string,
  inputHashToMatch: string,
): string {
  const inputHash = getInputHash(inputData, identifierFromPurchaser);
  if (inputHashToMatch === inputHash) {
    return inputHash;
  }
  const inputHashDeprecated = getInputHashDeprecated(
    inputData,
    identifierFromPurchaser,
  );
  if (inputHashToMatch === inputHashDeprecated) {
    return inputHashDeprecated;
  }
  throw new JobError(
    JobErrorCode.INPUT_HASH_MISMATCH,
    "Input data hash mismatch",
  );
}

export async function getMyJobsByAgentId(
  agentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithStatus[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;
  const activeOrganizationId = session.session.activeOrganizationId;

  if (activeOrganizationId) {
    // Show jobs for the specific organization
    return await jobRepository.getJobsByAgentIdUserIdAndOrganizationId(
      agentId,
      userId,
      activeOrganizationId,
      tx,
    );
  } else {
    // Show personal jobs only (without organization context)
    return await jobRepository.getPersonalJobsByAgentIdAndUserId(
      agentId,
      userId,
      tx,
    );
  }
}

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

export async function startJob(input: StartJobInputSchemaType): Promise<Job> {
  return await Sentry.startSpan(
    {
      op: "job.start",
      name: "startJob",
      attributes: {
        "job.agent_id": input.agentId,
        "job.user_id": input.userId,
      },
    },
    async (span) => {
      const { userId, agentId, maxAcceptedCents, inputData, inputSchema } =
        input;
      const organizationId = await getActiveOrganizationId();
      // Set comprehensive context for the job start operation
      Sentry.setTag("service", "job");
      Sentry.setTag("operation", "startJob");
      Sentry.setContext("job_start_request", {
        userId,
        agentId,
        organizationId,
      });

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

      const [agent, creditsPrice, amountsPrice] = await prisma.$transaction(
        async (tx) => {
          // Add breadcrumb for database transaction
          Sentry.addBreadcrumb({
            category: "Job Service",
            message: "Starting database transaction for job validation",
            level: "info",
            data: { agentId },
          });

          const agent = await getAvailableAgentById(agentId, tx);
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

          const amountsPrice: PricingAmountsSchemaType =
            agent.pricing.fixedPricing?.amounts.map((amount) => ({
              unit: amount.unit,
              amount: Number(amount.amount),
            })) ?? [];
          if (amountsPrice.length === 0) {
            Sentry.setTag("error_type", "agent_pricing_not_found");
            Sentry.setContext("agent_pricing", {
              agentId,
              agentName: agent.name,
              hasPricing: !!agent.pricing.fixedPricing,
              pricingAmountsLength: amountsPrice.length,
            });

            Sentry.captureMessage(
              `Agent pricing not found: ${agentId}`,
              "error",
            );
            throw new JobError(
              JobErrorCode.AGENT_PRICING_NOT_FOUND,
              "Agent pricing not found",
            );
          }

          const creditsPrice = await getCreditsPrice(amountsPrice, tx);
          if (creditsPrice.cents > maxAcceptedCents) {
            Sentry.setTag("error_type", "cost_too_high");
            Sentry.setContext("cost_validation", {
              agentId,
              creditsCents: creditsPrice.cents,
              maxAcceptedCents,
              organizationId,
            });

            Sentry.captureMessage(
              `Credit cost too high: ${creditsPrice.cents} > ${maxAcceptedCents}`,
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
              creditsCents: creditsPrice.cents,
              organizationId,
            },
          });

          if (creditsPrice.cents > 0) {
            try {
              if (organizationId) {
                await validateOrganizationCreditsBalance(
                  organizationId,
                  creditsPrice.cents,
                  tx,
                );
              } else {
                await validateCreditsBalance(userId, creditsPrice.cents, tx);
              }
            } catch (error) {
              Sentry.setTag("error_type", "insufficient_balance");
              Sentry.setContext("balance_validation", {
                userId,
                organizationId,
                creditsCents: creditsPrice.cents,
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
              creditsCents: creditsPrice.cents,
              organizationId,
            },
          });

          return [agent, creditsPrice, amountsPrice];
        },
      );

      // Start job
      const identifierFromPurchaser = uuidv4()
        .replace(/-/g, "")
        .substring(0, 20);

      // Add breadcrumb for agent job start
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Starting agent job via external API",
        level: "info",
        data: {
          agentId,
          agentName: agent.name,
          identifierFromPurchaser,
        },
      });

      const startJobResult = await startAgentJob(
        agent,
        identifierFromPurchaser,
        inputData,
      );
      if (!startJobResult.ok) {
        Sentry.setTag("error_type", "agent_job_start_failed");
        Sentry.setContext("agent_job_start", {
          agentId,
          agentName: agent.name,
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
      span.setAttribute("job.agent_job_id", startJobResponse.job_id);
      span.setAttribute(
        "job.blockchain_identifier",
        startJobResponse.blockchainIdentifier,
      );
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

      let matchedInputHash: string;
      try {
        matchedInputHash = getMatchedInputHash(
          inputData,
          identifierFromPurchaser,
          startJobResponse.input_hash,
        );
      } catch (error) {
        Sentry.setTag("error_type", "input_hash_mismatch");
        Sentry.setContext("input_hash_validation", {
          agentId,
          identifierFromPurchaser,
          expectedHash: startJobResponse.input_hash,
          agentJobId: startJobResponse.job_id,
        });
        throw error;
      }

      // Check if amounts are correct
      const jobAmountsPrice: PricingAmountsSchemaType =
        startJobResponse.amounts.map((amount) => ({
          unit: amount.unit,
          amount: Number(amount.amount),
        }));

      // Add breadcrumb for pricing validation
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Validating pricing schema",
        level: "info",
        data: {
          agentAmountsCount: amountsPrice.length,
          jobAmountsCount: jobAmountsPrice.length,
        },
      });

      try {
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
            agentName: agent.name,
          },
        });

        generatedName = await generateJobName(
          {
            name: agent.name,
            description: agent.description,
          },
          inputData,
        );
      } catch (error) {
        Sentry.withScope((scope) => {
          scope.setTag("error_type", "job_name_generation_failed");
          scope.setContext("job_name_generation", {
            agentId,
            agentName: agent.name,
            agentDescription: agent.description,
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
        creditsPrice,
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
      const createPurchaseResult = await createPurchase(
        agent,
        startJobResponse,
        inputData,
        matchedInputHash,
        identifierFromPurchaser,
      );
      if (createPurchaseResult.ok) {
        const purchase = createPurchaseResult.data.data as Purchase;
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
        console.error(
          "Error publishing job status data after creating job",
          err,
        );
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
    },
  );
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
async function validateCreditsBalance(
  userId: string,
  cents: bigint,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
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
async function validateOrganizationCreditsBalance(
  organizationId: string,
  cents: bigint,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
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
}

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

function shouldSyncMasumiStatus(job: Job): boolean {
  return job.refundedCreditTransactionId === null;
}

async function resolvePurchaseOfJob(job: Job): Promise<Purchase | null> {
  const client = getPaymentClient();
  try {
    const purchaseResponse = await postPurchaseResolveBlockchainIdentifier({
      client: client,
      body: {
        blockchainIdentifier: job.blockchainIdentifier,
        network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
      },
    });
    if (!purchaseResponse.data) {
      return null;
    }
    return purchaseResponse.data.data;
  } catch {
    return null;
  }
}

export async function syncJob(job: Job) {
  const oldJobStatus = computeJobStatus(job);
  if (!job.purchaseId) {
    const purchase = await resolvePurchaseOfJob(job);
    if (purchase) {
      job = await jobRepository.updateJobWithPurchase(job.id, purchase);
    }
  }
  const [agentJobStatus, onChainPurchase] = await Promise.all([
    shouldSyncAgentStatus(job) ? getAgentJobStatus(job) : null,
    shouldSyncMasumiStatus(job) ? getOnChainPurchase(job.purchaseId) : null,
  ]);

  const newJobStatus = await prisma.$transaction(
    async (tx) => {
      if (onChainPurchase) {
        job = await syncRegistryStatus(job, onChainPurchase, tx);
      }
      if (agentJobStatus) {
        job = await syncAgentJobStatus(job, agentJobStatus, tx);
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

    try {
      await publishJobStatusData(job);
    } catch (err) {
      console.error("Error publishing job status data", err);
    }
  }
}

async function syncRegistryStatus(
  job: Job,
  purchase: Purchase,
  tx: Prisma.TransactionClient,
): Promise<Job> {
  try {
    return await jobRepository.updateJobWithPurchase(job.id, purchase, tx);
  } catch {
    console.log("Error syncing registry status: ", job.id);
    return job;
  }
}

async function syncAgentJobStatus(
  job: Job,
  jobStatusResponse: JobStatusResponse,
  tx: Prisma.TransactionClient,
): Promise<Job> {
  try {
    return await jobRepository.updateJobWithAgentJobStatus(
      job,
      jobStatusResponse,
      tx,
    );
  } catch {
    console.log("Error syncing agent job status: ", job.id);
    return job;
  }
}

async function getOnChainPurchase(
  jobPurchaseId: string | null,
): Promise<Purchase | null> {
  if (jobPurchaseId === null) {
    return null;
  }
  const purchaseResult = await getPaymentClientPurchase(jobPurchaseId);
  if (!purchaseResult.ok) {
    return null;
  }
  return purchaseResult.data;
}

export async function getAgentJobStatus(
  job: Job,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobStatusResponse | null> {
  const agent = await agentRepository.getAgentWithRelationsById(
    job.agentId,
    tx,
  );
  if (!agent) {
    return null;
  }
  const jobStatusResult = await fetchAgentJobStatus(agent, job.agentJobId);
  if (!jobStatusResult.ok) {
    return null;
  }
  return jobStatusResult.data;
}

export async function requestRefundJob(
  jobBlockchainIdentifier: string,
): Promise<JobWithStatus> {
  return await Sentry.startSpan(
    {
      op: "job.refund",
      name: "requestRefundJob",
      attributes: {
        "job.blockchain_identifier": jobBlockchainIdentifier,
      },
    },
    async (_span) => {
      Sentry.setTag("service", "job");
      Sentry.setTag("operation", "requestRefundJob");
      Sentry.setContext("job_refund_request", {
        blockchainIdentifier: jobBlockchainIdentifier,
      });

      // Add breadcrumb for refund request
      Sentry.addBreadcrumb({
        category: "Job Service",
        message: "Requesting job refund",
        level: "info",
        data: {
          blockchainIdentifier: jobBlockchainIdentifier,
        },
      });

      const refundResult = await postPaymentClientRequestRefund(
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
    },
  );
}

/**
 * Get the latest job's JobStatusData for each agent
 * @param agentIds - The IDs of the agents to get the latest job status for
 * @param tx - The transaction client to use for the database operations
 * @returns The latest job's JobStatusData for each agent
 */
export async function getAgentJobStatusDataListByAgentIds(
  agentIds: string[],
  tx: Prisma.TransactionClient = prisma,
): Promise<(JobStatusData | null)[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;
  const activeOrganizationId = session.session.activeOrganizationId;

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
}
