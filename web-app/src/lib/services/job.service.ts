import "server-only";

import * as Sentry from "@sentry/nextjs";
import { v4 as uuidv4 } from "uuid";

import { getEnvPublicConfig } from "@/config/env.public";
import { JobStatusData } from "@/lib/ably";
import publishJobStatusData from "@/lib/ably/publish";
import { JobError, JobErrorCode } from "@/lib/actions/types/error-codes/job";
import {
  getPurchase,
  postPurchase,
  postPurchaseRequestRefund,
  postPurchaseResolveBlockchainIdentifier,
  PostPurchaseResponse,
} from "@/lib/api/generated/payment";
import { getPaymentClient } from "@/lib/api/payment-service.client";
import { getActiveOrganizationId, getSessionOrThrow } from "@/lib/auth/utils";
import {
  computeJobStatus,
  jobStatusToAgentJobStatus,
  nextActionToNextJobAction,
  onChainStateToOnChainJobStatus,
  transactionStatusToOnChainTransactionStatus,
} from "@/lib/db/helpers/job";
import { prisma } from "@/lib/db/repositories";
import {
  AgentWithRelations,
  CreditsPrice,
  finalizedOnChainJobStatuses,
  jobInclude,
  jobLimitedInclude,
  jobOrderBy,
  JobStatus,
  JobWithLimitedInformation,
  JobWithStatus,
} from "@/lib/db/types";
import { generateJobName } from "@/lib/generateJobName";
import { JobInputData, JobInputSchemaType } from "@/lib/job-input";
import {
  PricingAmountsSchemaType,
  StartJobInputSchemaType,
  StartJobResponseSchemaType,
} from "@/lib/schemas";
import { Err, Ok, Result } from "@/lib/ts-res";
import { getInputHash, getInputHashDeprecated } from "@/lib/utils";
import {
  AgentJobStatus,
  Job,
  NextJobAction,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

import { AgentService } from "./agent.service";
import { BaseService } from "./base.service";
import { CreditCostService } from "./creditCost.service";
import { CreditTransactionService } from "./creditTransaction.service";

interface CreateJobData {
  agentJobId: string;
  agentId: string;
  userId: string;
  organizationId: string | null | undefined;
  inputSchema: JobInputSchemaType[];
  input: string;
  purchaseId?: string;
  creditsPrice: CreditsPrice;
  identifierFromPurchaser: string;
  payByTime: Date;
  externalDisputeUnlockTime: Date;
  submitResultTime: Date;
  unlockTime: Date;
  blockchainIdentifier: string;
  sellerVkey: string;
  name: string | null;
}

export class JobService extends BaseService<JobService> {
  static mapJobWithStatus<T extends Job>(job: T): T & { status: JobStatus } {
    return {
      ...job,
      status: computeJobStatus(job),
    };
  }

  async getJobById(jobId: string) {
    const job = await this.client.job.findUnique({
      where: { id: jobId },
      include: jobInclude,
    });
    if (!job) {
      return null;
    }
    return JobService.mapJobWithStatus(job);
  }

  async getJobByBlockchainIdentifier(blockchainIdentifier: string) {
    const job = await this.client.job.findUnique({
      where: { blockchainIdentifier },
      include: jobInclude,
    });
    if (!job) {
      return null;
    }
    return JobService.mapJobWithStatus(job);
  }

  async getJobsByUserId(userId: string): Promise<JobWithStatus[]> {
    const jobs = await this.client.job.findMany({
      where: { userId },
      include: jobInclude,
      orderBy: jobOrderBy,
    });
    return jobs.map(JobService.mapJobWithStatus);
  }

  async getJobsWithLimitedInformationByAgentId(
    agentId: string,
  ): Promise<JobWithLimitedInformation[]> {
    const jobs = await this.client.job.findMany({
      where: { agentId },
      select: jobLimitedInclude,
      orderBy: jobOrderBy,
    });

    return jobs;
  }

  async getJobsByAgentIdUserIdAndOrganizationId(
    agentId: string,
    userId: string,
    organizationId: string,
  ): Promise<JobWithStatus[]> {
    const jobs = await this.client.job.findMany({
      where: {
        agentId,
        userId,
        organizationId,
      },
      include: jobInclude,
      orderBy: jobOrderBy,
    });

    return jobs.map(JobService.mapJobWithStatus);
  }

  async getPersonalJobsByAgentIdAndUserId(
    agentId: string,
    userId: string,
  ): Promise<JobWithStatus[]> {
    const jobs = await this.client.job.findMany({
      where: {
        agentId,
        userId,
        organizationId: null,
      },
      include: jobInclude,
      orderBy: jobOrderBy,
    });

    return jobs.map(JobService.mapJobWithStatus);
  }

  async createJob(data: CreateJobData): Promise<Job> {
    // Build the credit transaction data based on whether it's for a user or organization
    const creditTransactionData: Prisma.CreditTransactionCreateInput = {
      amount: -data.creditsPrice.cents,
      includedFee: data.creditsPrice.includedFee,
      user: {
        connect: {
          id: data.userId,
        },
      },
      ...(data.organizationId && {
        organization: {
          connect: {
            id: data.organizationId,
          },
        },
      }),
    };

    return await this.client.job.create({
      data: {
        agentJobId: data.agentJobId,
        agent: {
          connect: {
            id: data.agentId,
          },
        },
        user: {
          connect: {
            id: data.userId,
          },
        },
        ...(data.organizationId && {
          organization: {
            connect: {
              id: data.organizationId,
            },
          },
        }),
        creditTransaction: {
          create: creditTransactionData,
        },
        ...(data.purchaseId && {
          purchaseId: data.purchaseId,
        }),
        inputSchema: data.inputSchema,
        input: data.input,
        identifierFromPurchaser: data.identifierFromPurchaser,
        payByTime: data.payByTime,
        externalDisputeUnlockTime: data.externalDisputeUnlockTime,
        submitResultTime: data.submitResultTime,
        unlockTime: data.unlockTime,
        blockchainIdentifier: data.blockchainIdentifier,
        sellerVkey: data.sellerVkey,
        name: data.name,
      },
    });
  }

  async refundJob(jobId: string) {
    const job = await this.client.job.findUnique({
      where: { id: jobId },
      select: { refundedCreditTransaction: true },
    });

    // If the job has already been refunded, do nothing
    if (job?.refundedCreditTransaction) {
      return;
    }

    const creditTransaction =
      await CreditTransactionService.getInstance().getCreditTransactionByJobId(
        jobId,
      );
    if (!creditTransaction) {
      throw new Error("Credit transaction not found");
    }

    // Build refund transaction data based on whether it's for a user or organization
    const refundTransactionData: Prisma.CreditTransactionCreateInput = {
      amount: creditTransaction.amount * BigInt(-1),
      includedFee: creditTransaction.includedFee,
      user: {
        connect: {
          id: creditTransaction.userId,
        },
      },
      ...(creditTransaction.organizationId && {
        organization: {
          connect: {
            id: creditTransaction.organizationId,
          },
        },
      }),
    };

    await this.client.job.update({
      where: { id: jobId },
      data: {
        refundedCreditTransaction: {
          create: refundTransactionData,
        },
      },
    });
  }

  async updateJobWithAgentJobStatus(
    job: Job,
    jobStatusResponse: JobStatusResponse,
  ) {
    const output = JSON.stringify(jobStatusResponse);
    const agentJobStatus = jobStatusToAgentJobStatus(jobStatusResponse.status);
    const data: Prisma.JobUpdateInput = {
      agentJobStatus,
      output,
      ...(agentJobStatus === AgentJobStatus.COMPLETED &&
        job.completedAt === null && {
          completedAt: new Date(),
        }),
    };

    const updatedJob = await this.client.job.update({
      where: { id: job.id },
      data,
      include: jobInclude,
    });
    return JobService.mapJobWithStatus(updatedJob);
  }

  async updateJobWithPurchase(jobId: string, purchase: Purchase) {
    const onChainStatus = onChainStateToOnChainJobStatus(purchase.onChainState);
    let data: Prisma.JobUpdateInput = {
      purchaseId: purchase.id,
      onChainStatus,
      inputHash: purchase.inputHash,
      outputHash: purchase.resultHash,
    };
    if (onChainStatus === OnChainJobStatus.RESULT_SUBMITTED) {
      data.resultSubmittedAt = new Date();
    }

    const nextAction = nextActionToNextJobAction(purchase.NextAction);
    data = {
      ...data,
      nextAction: nextAction.requestedAction,
      nextActionErrorType: nextAction.errorType,
      nextActionErrorNote: nextAction.errorNote,
    };

    const transaction = purchase.CurrentTransaction;
    if (transaction) {
      data = {
        ...data,
        onChainTransactionHash: transaction.txHash,
        onChainTransactionStatus: transactionStatusToOnChainTransactionStatus(
          transaction.status,
        ),
      };
    }

    const job = await this.client.job.update({
      where: { id: jobId },
      data,
      include: jobInclude,
    });
    return JobService.mapJobWithStatus(job);
  }

  async updateJobNextActionByBlockchainIdentifier(
    jobBlockchainIdentifier: string,
    nextJobAction: NextJobAction,
  ) {
    const job = await this.client.job.update({
      where: { blockchainIdentifier: jobBlockchainIdentifier },
      data: { nextAction: nextJobAction },
      include: jobInclude,
    });
    return JobService.mapJobWithStatus(job);
  }

  async updateJobNameById(jobId: string, name: string | null) {
    return await this.client.job.update({
      where: { id: jobId },
      data: { name },
    });
  }

  static jobsNotFinishedWhereQuery = (
    cutoffTime: Date = new Date(Date.now() - 1000 * 60 * 10),
  ): Prisma.JobWhereInput => ({
    OR: [
      // Filter out jobs that are finalized
      {
        onChainStatus: {
          notIn: finalizedOnChainJobStatuses,
        },
      },
      // Filter in jobs that have no on-chain status
      {
        onChainStatus: null,
      },
    ],
    NOT: [
      // Filter out jobs that are refunded
      {
        refundedCreditTransactionId: {
          not: null,
        },
      },
      // Filter out jobs that are non-disputed and have a externalDisputeUnlockTime that is less than the cutoff time
      {
        onChainStatus: { not: OnChainJobStatus.DISPUTED },
        externalDisputeUnlockTime: {
          lt: cutoffTime,
        },
      },
      // Filter out jobs that have no on-chain status and have a payByTime that is less than the cutoff time
      {
        onChainStatus: null,
        payByTime: {
          lt: cutoffTime,
        },
      },
    ],
  });

  async getLatestJobStatusByAgentIdUserIdAndOrganization(
    agentId: string,
    userId: string,
    organizationId: string | null | undefined,
  ): Promise<JobStatus | null> {
    // Normalize undefined to null for organizationId to ensure correct filtering (Prisma ignores undefined)
    const normalizedOrganizationId = organizationId ?? null;
    const job = await this.client.job.findFirst({
      where: {
        agentId,
        userId,
        organizationId: normalizedOrganizationId,
        ...JobService.jobsNotFinishedWhereQuery(),
      },
      orderBy: { startedAt: "desc" },
      include: jobInclude,
    });
    return job ? computeJobStatus(job) : null;
  }

  // Third party methods
  async requestRefundByBlockchainIdentifier(
    jobBlockchainIdentifier: string,
  ): Promise<Result<void, string>> {
    try {
      const paymentClient = getPaymentClient();
      const refundResponse = await postPurchaseRequestRefund({
        client: paymentClient,
        body: {
          blockchainIdentifier: jobBlockchainIdentifier,
          network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
        },
      });

      if (refundResponse.error || !refundResponse.data) {
        return Err("Failed to request refund");
      }

      return Ok();
    } catch (err) {
      return Err(String(err));
    }
  }

  async createPurchase(
    agent: AgentWithRelations,
    startJobResponse: StartJobResponseSchemaType,
    inputData: JobInputData,
    inputHash: string,
    identifierFromPurchaser: string,
  ): Promise<Result<PostPurchaseResponse, string>> {
    try {
      const paymentClient = getPaymentClient();

      const postPurchaseResponse = await postPurchase({
        client: paymentClient,
        body: {
          agentIdentifier: agent.blockchainIdentifier,
          inputHash: inputHash,
          blockchainIdentifier: startJobResponse.blockchainIdentifier,
          network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
          sellerVkey: startJobResponse.sellerVKey,
          paymentType: "Web3CardanoV1",
          identifierFromPurchaser,
          payByTime: startJobResponse.payByTime.toString(),
          externalDisputeUnlockTime:
            startJobResponse.externalDisputeUnlockTime.toString(),
          submitResultTime: startJobResponse.submitResultTime.toString(),
          unlockTime: startJobResponse.unlockTime.toString(),
          metadata: JSON.stringify({
            inputData: Object.fromEntries(inputData),
            jobId: startJobResponse.job_id,
          }),
        },
      });

      if (postPurchaseResponse.error || !postPurchaseResponse.data) {
        console.log(
          "Failed to create purchase request",
          postPurchaseResponse.error,
        );
        return Err("Failed to create purchase request");
      }

      return Ok(postPurchaseResponse.data);
    } catch (err) {
      return Err(String(err));
    }
  }

  async getPurchaseById(purchaseId: string): Promise<Result<Purchase, string>> {
    try {
      const paymentClient = getPaymentClient();
      const purchaseResponse = await getPurchase({
        client: paymentClient,
        query: {
          cursorId: purchaseId,
          network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
          limit: 1,
        },
      });

      if (
        purchaseResponse.error ||
        !purchaseResponse.data ||
        purchaseResponse.data.data.Purchases.length != 1
      ) {
        return Err(
          purchaseResponse.error
            ? String(purchaseResponse.error)
            : "Unknown error",
        );
      }
      const purchase = purchaseResponse.data.data.Purchases[0];

      return Ok(purchase);
    } catch (err) {
      return Err(String(err));
    }
  }

  // Service
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

            const agent =
              await AgentService.getInstance(tx).getAvailableAgentById(agentId);
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
              throw new JobError(
                JobErrorCode.AGENT_NOT_FOUND,
                "Agent not found",
              );
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

            const creditsPrice =
              await CreditCostService.getInstance(tx).getCreditsPrice(
                amountsPrice,
              );
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
                  await this.validateOrganizationCreditsBalance(
                    organizationId,
                    creditsPrice.cents,
                    tx,
                  );
                } else {
                  await this.validateCreditsBalance(
                    userId,
                    creditsPrice.cents,
                    tx,
                  );
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

        const startJobResult = await AgentService.getInstance().startAgentJob(
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
          matchedInputHash = this.getMatchedInputHash(
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
          this.tryValidatePricing(amountsPrice, jobAmountsPrice);
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

        const job = await JobService.getInstance().createJob({
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
        const createPurchaseResult =
          await JobService.getInstance().createPurchase(
            agent,
            startJobResponse,
            inputData,
            matchedInputHash,
            identifierFromPurchaser,
          );
        if (createPurchaseResult.ok) {
          const purchase = createPurchaseResult.data.data as Purchase;
          await JobService.getInstance().updateJobWithPurchase(
            job.id,
            purchase,
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

        const jobStatusData: JobStatusData = {
          id: job.id,
          agentId: job.agentId,
          jobStatus: computeJobStatus(job),
          onChainStatus: job.onChainStatus,
          agentJobStatus: job.agentJobStatus,
          createdAt: job.createdAt.toISOString(),
          startedAt: job.startedAt.toISOString(),
          completedAt: job.completedAt?.toISOString() ?? null,
        };

        try {
          await publishJobStatusData(jobStatusData, job.userId);
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

  private tryValidatePricing(
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

  private getMatchedInputHash(
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

  private async validateCreditsBalance(
    userId: string,
    cents: bigint,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> {
    const centsBalance =
      await CreditTransactionService.getInstance(tx).getCentsByUserId(userId);
    if (centsBalance - cents < BigInt(0)) {
      throw new JobError(
        JobErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance",
      );
    }
  }

  private async validateOrganizationCreditsBalance(
    organizationId: string,
    cents: bigint,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> {
    const centsBalance =
      await CreditTransactionService.getInstance(tx).getCentsByOrganizationId(
        organizationId,
      );
    if (centsBalance - cents < BigInt(0)) {
      throw new JobError(
        JobErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance",
      );
    }
  }

  async requestRefundJob(
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

        const refundResult =
          await JobService.getInstance().requestRefundByBlockchainIdentifier(
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
          await JobService.getInstance().updateJobNextActionByBlockchainIdentifier(
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

  async getAgentJobStatusesByAgentIds(
    agentIds: string[],
  ): Promise<(JobStatus | null)[]> {
    const session = await getSessionOrThrow();
    const userId = session.user.id;
    const activeOrganizationId = session.session.activeOrganizationId;

    return await Promise.all(
      agentIds.map((agentId) =>
        this.getLatestJobStatusByAgentIdUserIdAndOrganization(
          agentId,
          userId,
          activeOrganizationId,
        ),
      ),
    );
  }

  async syncJob(job: Job) {
    const oldJobStatus = computeJobStatus(job);
    if (!job.purchaseId) {
      const purchase = await this.resolvePurchaseOfJob(job);
      if (purchase) {
        job = await JobService.getInstance().updateJobWithPurchase(
          job.id,
          purchase,
        );
      }
    }
    const [agentJobStatus, onChainPurchase] = await Promise.all([
      this.shouldSyncAgentStatus(job) ? this.getAgentJobStatus(job) : null,
      this.shouldSyncMasumiStatus(job)
        ? this.getOnChainPurchase(job.purchaseId)
        : null,
    ]);

    const newJobStatus = await prisma.$transaction(
      async (tx) => {
        if (onChainPurchase) {
          job = await this.syncRegistryStatus(job, onChainPurchase, tx);
        }
        if (agentJobStatus) {
          job = await this.syncAgentJobStatus(job, agentJobStatus, tx);
        }
        const jobStatus = computeJobStatus(job);
        switch (jobStatus) {
          case JobStatus.PAYMENT_FAILED:
          case JobStatus.REFUND_RESOLVED:
            await JobService.getInstance(tx).refundJob(job.id);
            break;
          case JobStatus.OUTPUT_PENDING:
            await this.requestRefundIfNeeded(job);
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
      const jobStatusData: JobStatusData = {
        id: job.id,
        agentId: job.agentId,
        jobStatus: newJobStatus,
        onChainStatus: job.onChainStatus,
        agentJobStatus: job.agentJobStatus,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt.toISOString(),
        completedAt: job.completedAt?.toISOString() ?? null,
      };

      try {
        await publishJobStatusData(jobStatusData, job.userId);
      } catch (err) {
        console.error("Error publishing job status data", err);
      }
    }
  }

  private shouldSyncAgentStatus(job: Job): boolean {
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

  private shouldSyncMasumiStatus(job: Job): boolean {
    return job.refundedCreditTransactionId === null;
  }

  private async resolvePurchaseOfJob(job: Job): Promise<Purchase | null> {
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

  private async getOnChainPurchase(
    jobPurchaseId: string | null,
  ): Promise<Purchase | null> {
    if (jobPurchaseId === null) {
      return null;
    }
    const purchaseResult = await this.getPurchaseById(jobPurchaseId);
    if (!purchaseResult.ok) {
      return null;
    }
    return purchaseResult.data;
  }

  private async getAgentJobStatus(job: Job): Promise<JobStatusResponse | null> {
    const agentService = AgentService.getInstance();
    const agent = await agentService.getAgentWithRelationsById(job.agentId);
    if (!agent) {
      return null;
    }
    const jobStatusResult = await agentService.fetchAgentJobStatus(
      agent,
      job.agentJobId,
    );
    if (!jobStatusResult.ok) {
      return null;
    }
    return jobStatusResult.data;
  }

  private async syncRegistryStatus(
    job: Job,
    purchase: Purchase,
    tx: Prisma.TransactionClient,
  ): Promise<Job> {
    try {
      return await JobService.getInstance(tx).updateJobWithPurchase(
        job.id,
        purchase,
      );
    } catch {
      console.log("Error syncing registry status: ", job.id);
      return job;
    }
  }

  private async syncAgentJobStatus(
    job: Job,
    jobStatusResponse: JobStatusResponse,
    tx: Prisma.TransactionClient,
  ): Promise<Job> {
    try {
      return await JobService.getInstance(tx).updateJobWithAgentJobStatus(
        job,
        jobStatusResponse,
      );
    } catch {
      console.log("Error syncing agent job status: ", job.id);
      return job;
    }
  }

  private async requestRefundIfNeeded(job: Job) {
    let shouldRequestRefund = false;
    const currentTime = new Date();

    // Check if we're within 1 hour of unlock time
    const oneHourBeforeUnlock = new Date(
      job.unlockTime.getTime() - 60 * 60 * 1000, // 1 hour before unlock
    );

    if (currentTime >= oneHourBeforeUnlock) {
      shouldRequestRefund = true;
    }

    // Check if result was submitted more than 10 minutes ago
    const resultSubmittedAt = job.resultSubmittedAt;
    if (
      resultSubmittedAt &&
      currentTime.getTime() - resultSubmittedAt.getTime() > 10 * 60 * 1000 // 10 minutes
    ) {
      shouldRequestRefund = true;
    }

    // Only make one refund request if either condition is met
    if (shouldRequestRefund) {
      const refundResult =
        await JobService.getInstance().requestRefundByBlockchainIdentifier(
          job.blockchainIdentifier,
        );
      if (!refundResult.ok) {
        console.error(
          `Failed to request refund for job ${job.id}:`,
          refundResult.error,
        );
      }
    }
  }

  async getMyJobsByAgentId(agentId: string): Promise<JobWithStatus[]> {
    const session = await getSessionOrThrow();
    const userId = session.user.id;
    const activeOrganizationId = session.session.activeOrganizationId;

    if (activeOrganizationId) {
      // Show jobs for the specific organization
      return await this.getJobsByAgentIdUserIdAndOrganizationId(
        agentId,
        userId,
        activeOrganizationId,
      );
    } else {
      // Show personal jobs only (without organization context)
      return await this.getPersonalJobsByAgentIdAndUserId(agentId, userId);
    }
  }
}
