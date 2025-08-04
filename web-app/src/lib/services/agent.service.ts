import "server-only";

import * as Sentry from "@sentry/nextjs";
import { JobStatusData } from "src/lib/ably/schema";
import { v4 as uuidv4 } from "uuid";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import publishJobStatusData from "@/lib/ably/publish";
import { JobError, JobErrorCode } from "@/lib/actions/types/error-codes/job";
import { getSession, getSessionOrThrow } from "@/lib/auth/utils";
import { agentClient, paymentClient } from "@/lib/clients";
import {
  AgentWithCreditPrice,
  AgentWithFixedPricing,
  AgentWithJobs,
  AgentWithOrganizations,
  AgentWithRelations,
  computeJobStatus,
  convertCreditsToCents,
  CreditsPrice,
  getJobStatusData,
  JobStatus,
  JobWithStatus,
} from "@/lib/db";
import {
  agentListRepository,
  agentRepository,
  creditCostRepository,
  creditTransactionRepository,
  jobRepository,
  mapAgentWithIsNew,
  memberRepository,
  prisma,
} from "@/lib/db/repositories";
import { generateJobName } from "@/lib/generateJobName";
import { JobInputData } from "@/lib/job-input";
import {
  pricingAmountsSchema,
  PricingAmountsSchemaType,
  StartJobInputSchemaType,
} from "@/lib/schemas";
import { getInputHash, getInputHashDeprecated } from "@/lib/utils";
import {
  AgentJobStatus,
  AgentListType,
  AgentStatus,
  CreditCost,
  Job,
  NextJobAction,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

import { userService } from "./user.service";

export const agentService = {
  async getFavoriteAgents(): Promise<AgentWithRelations[]> {
    return await getAgentsByListType(AgentListType.FAVORITE);
  },

  /**
   * Retrieves all online agents available to the current user with valid pricing.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns Array of available agents with valid pricing.
   */
  async getAvailableAgents(): Promise<AgentWithRelations[]> {
    return await prisma.$transaction(async (tx) => {
      const { userOrganizationIds, creditCosts } =
        await getAgentAccessContext(tx);
      const onlineAgents =
        await agentRepository.getShownAgentsWithRelationsByStatus(
          AgentStatus.ONLINE,
          tx,
        );
      return onlineAgents.filter((agent) =>
        isAgentAvailable(agent, userOrganizationIds, creditCosts),
      );
    });
  },

  /**
   * Retrieves an available agent by ID, validating access control for the current user.
   *
   * - Returns null if the agent doesn't exist, is not shown, or the user lacks access.
   * - Returns the agent if accessible.
   *
   * @param agentId - Unique agent identifier.
   * @returns The agent with all relations if accessible, null otherwise.
   */
  async getAvailableAgentById(
    agentId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentWithRelations | null> {
    const agent = await agentRepository.getShownAgentWithRelationById(
      agentId,
      AgentStatus.ONLINE,
      tx,
    );
    if (!agent) return null;
    const { userOrganizationIds, creditCosts } =
      await getAgentAccessContext(tx);
    if (!isAgentAvailable(agent, userOrganizationIds, creditCosts)) return null;
    return agent;
  },

  /**
   * Retrieves all online agents available to the user, each with its calculated credit price.
   *
   * - Excludes agents for which credit price calculation fails.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns Array of agents with their calculated credit prices.
   */
  async getAvailableAgentsWithCreditsPrice(): Promise<AgentWithCreditPrice[]> {
    const agents = await this.getAvailableAgents();
    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        const creditsPrice = await this.getAgentCreditsPrice(agent);
        return { agent, creditsPrice };
      }),
    );
    return results
      .filter(
        (result): result is PromiseFulfilledResult<AgentWithCreditPrice> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
  },

  /**
   * Retrieves all agents hired by the current user, ordered by the most recent job activity (newest first).
   *
   * - Requires an active user session.
   * - Agents without jobs are placed at the end of the list.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns Array of hired agents with their jobs, sorted by recent activity.
   * @throws If no active session is found.
   */
  async getHiredAgents(): Promise<AgentWithJobs[]> {
    const session = await getSessionOrThrow();
    const userId = session.user.id;
    const activeOrganizationId = session.session.activeOrganizationId;
    const hiredAgentsWithJobs =
      await agentRepository.getHiredAgentsWithJobsByUserIdAndOrganization(
        userId,
        activeOrganizationId,
      );
    return hiredAgentsWithJobs.sort((a, b) => {
      const aLatestJob = a.jobs[0];
      const bLatestJob = b.jobs[0];
      if (!aLatestJob) return 1;
      if (!bLatestJob) return -1;
      return bLatestJob.startedAt.getTime() - aLatestJob.startedAt.getTime();
    });
  },

  /**
   * Calculates the total credit price (in cents) for a given agent's fixed pricing.
   *
   * - Extracts the pricing amounts from the agent's fixed pricing configuration.
   * - Converts the amounts to the expected format.
   * - Delegates the calculation to `getCreditsPrice`.
   * - Returns zero if the agent has no pricing amounts.
   *
   * @param agent - The agent object containing fixed pricing information.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns An object containing the total price in cents and the included fee, both as bigint.
   */
  async getAgentCreditsPrice(
    agent: AgentWithFixedPricing,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<CreditsPrice> {
    const amounts = agent.pricing?.fixedPricing?.amounts?.map((amount) => ({
      unit: amount.unit,
      amount: Number(amount.amount),
    }));
    if (!amounts) {
      return { cents: BigInt(0), includedFee: BigInt(0) };
    }
    return await getCreditsPrice(amounts, tx);
  },

  async startJob(input: StartJobInputSchemaType): Promise<Job> {
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
        const activeOrganizationId =
          await userService.getActiveOrganizationId();
        // Set comprehensive context for the job start operation
        Sentry.setTag("service", "job");
        Sentry.setTag("operation", "startJob");
        Sentry.setContext("job_start_request", {
          userId,
          agentId,
          activeOrganizationId,
        });

        // Add breadcrumb for job start
        Sentry.addBreadcrumb({
          category: "Job Service",
          message: "Starting job service operation",
          level: "info",
          data: {
            agentId,
            userId,
            activeOrganizationId,
          },
        });

        const [agent, creditsPrice] = await prisma.$transaction(async (tx) => {
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
              activeOrganizationId,
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

          const creditsPrice = await agentService.getAgentCreditsPrice(
            agent,
            tx,
          );

          if (creditsPrice.cents > maxAcceptedCents) {
            Sentry.setTag("error_type", "cost_too_high");
            Sentry.setContext("cost_validation", {
              agentId,
              creditsCents: creditsPrice.cents,
              maxAcceptedCents,
              activeOrganizationId,
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
              activeOrganizationId,
            },
          });

          if (creditsPrice.cents > 0) {
            try {
              if (activeOrganizationId) {
                await validateOrganizationCreditsBalance(
                  activeOrganizationId,
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
                activeOrganizationId,
                creditsCents: creditsPrice.cents,
                isOrganization: !!activeOrganizationId,
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
              activeOrganizationId,
            },
          });

          return [agent, creditsPrice];
        });

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

        const startJobResult = await agentClient.startAgentJob(
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
        const amountsPrice =
          agent.pricing?.fixedPricing?.amounts.map((amount) => ({
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
          organizationId: activeOrganizationId,
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
        const createPurchaseResult = await paymentClient.createPurchase(
          agent.blockchainIdentifier,
          startJobResponse,
          inputData,
          matchedInputHash,
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
  },

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
  async requestRefund(jobBlockchainIdentifier: string): Promise<JobWithStatus> {
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

        const job =
          await jobRepository.updateJobNextActionByBlockchainIdentifier(
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
  },

  async syncJob(job: JobWithStatus) {
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
  },

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
  async getAgentJobStatusDataListByAgentIds(
    agentIds: string[],
    tx: Prisma.TransactionClient = prisma,
  ): Promise<(JobStatusData | null)[]> {
    const session = await getSession();
    if (!session) {
      return [];
    }
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
  },
};

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

/**
 * Returns the matching input hash for a job, supporting both current and deprecated hash formats.
 *
 * This function computes the input hash for the provided job input data and purchaser identifier,
 * and compares it to the given hash to match. If the current hash does not match, it also checks
 * against a deprecated hash format for backward compatibility. If neither matches, a JobError is thrown.
 *
 * @param inputData - The job input data used to compute the hash.
 * @param identifierFromPurchaser - The unique identifier from the purchaser, used in hash computation.
 * @param inputHashToMatch - The hash value to match against (could be current or deprecated).
 * @returns The matched input hash string (current or deprecated).
 * @throws {JobError} If neither the current nor deprecated input hash matches the provided value.
 */
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

/**
 * Calculates the total credit price (in cents) for a set of pricing amounts, including a configurable fee.
 *
 * - Fetches the credit cost per unit from the repository for each amount.
 * - Applies a fee percentage (from public config) to the subtotal.
 * - Ensures the total fee is at least the minimum fee (from secrets).
 * - Rounds up cents and fee to the nearest integer for each unit.
 *
 * @param amounts - Array of pricing amounts (unit and amount) to price.
 * @param tx - Optional Prisma transaction client for DB access (defaults to global prisma).
 * @returns An object containing the total price in cents and the included fee in cents.
 * @throws If the fee percentage is negative or a credit cost for a unit is not found.
 */
async function getCreditsPrice(
  amounts: PricingAmountsSchemaType,
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditsPrice> {
  const feePercentagePoints = getEnvPublicConfig().NEXT_PUBLIC_FEE_PERCENTAGE;
  if (feePercentagePoints < 0) {
    throw new Error("Added fee percentage must be equal to or greater than 0");
  }
  const feeMultiplier = feePercentagePoints / 100;
  const amountsParsed = pricingAmountsSchema.parse(amounts);

  let totalCents = BigInt(0);
  let totalFee = BigInt(0);
  const minFeeCents = convertCreditsToCents(getEnvSecrets().MIN_FEE_CREDITS);
  for (const amount of amountsParsed) {
    const creditCost = await creditCostRepository.getCreditCostByUnit(
      amount.unit,
      tx,
    );
    if (!creditCost) {
      throw new Error(`Credit cost not found for unit ${amount.unit}`);
    }
    const cents = amount.amount * Number(creditCost.centsPerUnit);
    const fee = cents * feeMultiplier;

    // round up to the nearest integer
    totalCents += BigInt(Math.ceil(cents));
    totalFee += BigInt(Math.ceil(fee));
  }
  if (totalFee < minFeeCents) {
    totalFee = minFeeCents;
  }
  return { cents: totalCents + totalFee, includedFee: totalFee };
}

/**
 * Utility: Checks if a user can access an agent based on organization membership and agent visibility.
 *
 * @param agent - Agent with organization data.
 * @param userOrganizationIds - Organization IDs the user is a member of.
 * @returns True if the user can access the agent, false otherwise.
 */
function canUserAccessAgent(
  agent: AgentWithOrganizations,
  userOrganizationIds: string[],
): boolean {
  if (!agent.isShown) return false;
  if (agent.organizations.length === 0) return true;
  if (userOrganizationIds.length === 0) return false;
  return agent.organizations.some((agentOrg) =>
    userOrganizationIds.includes(agentOrg.id),
  );
}

/**
 * Utility: Checks if an agent's fixed pricing units are all valid according to the provided credit costs.
 *
 * @param agent - Agent with fixed pricing information.
 * @param creditCosts - Array of valid credit cost objects.
 * @returns True if all pricing units are valid or if there are no amounts, false otherwise.
 */
function hasValidPricing(
  agent: AgentWithFixedPricing,
  creditCosts: CreditCost[],
): boolean {
  const units = creditCosts.map(({ unit }) => unit);
  const amounts = agent.pricing.fixedPricing?.amounts?.map((amount) => ({
    unit: amount.unit,
    amount: Number(amount.amount),
  }));
  if (!amounts) {
    return true;
  }
  return amounts.every(({ unit }) => units.includes(unit));
}

/**
 * Utility: Determines if an agent is available to the user based on access permissions and pricing validity.
 *
 * @param agent - Agent with relations including organization and pricing data.
 * @param organizationIds - Organization IDs the user is a member of.
 * @param creditCosts - Valid credit cost objects for pricing validation.
 * @returns True if the agent is available to the user, false otherwise.
 */
function isAgentAvailable(
  agent: AgentWithRelations,
  organizationIds: string[],
  creditCosts: CreditCost[],
): boolean {
  return (
    canUserAccessAgent(agent, organizationIds) &&
    hasValidPricing(agent, creditCosts)
  );
}

/**
 * Retrieves the current session's organization IDs and all credit costs for agent access checks.
 *
 * @param tx - Optional Prisma transaction client for DB operations.
 * @returns Object with userOrganizationIds and creditCosts.
 */
async function getAgentAccessContext(
  tx: Prisma.TransactionClient = prisma,
): Promise<{
  userOrganizationIds: string[];
  creditCosts: CreditCost[];
}> {
  const session = await getSession();
  const creditCosts = await creditCostRepository.getCreditCosts(tx);
  const userOrganizationIds =
    session?.user.id && session.user.id !== ""
      ? await memberRepository.getMembersOrganizationIdsByUserId(
          session.user.id,
          tx,
        )
      : [];
  return { userOrganizationIds, creditCosts };
}

async function getAgentsByListType(
  type: AgentListType,
): Promise<AgentWithRelations[]> {
  const session = await getSessionOrThrow();
  return await prisma.$transaction(async (tx) => {
    const existingList = await agentListRepository.getAgentListByUserId(
      session.user.id,
      type,
      tx,
    );
    if (existingList) {
      const { userOrganizationIds, creditCosts } =
        await getAgentAccessContext(tx);
      return existingList.agents
        .map(mapAgentWithIsNew)
        .filter((agent) =>
          isAgentAvailable(agent, userOrganizationIds, creditCosts),
        );
    }
    const list = await agentListRepository.createAgentListForUserId(
      session.user.id,
      type,
      tx,
    );
    return list.agents.map(mapAgentWithIsNew);
  });
}
