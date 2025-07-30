import "server-only";

import {
  computeJobStatus,
  jobStatusToAgentJobStatus,
  nextActionToNextJobAction,
  onChainStateToOnChainJobStatus,
  transactionStatusToOnChainTransactionStatus,
} from "@/lib/db/helpers/job";
import {
  CreditsPrice,
  finalizedOnChainJobStatuses,
  jobInclude,
  jobLimitedInclude,
  jobOrderBy,
  JobStatus,
  JobWithLimitedInformation,
  JobWithStatus,
} from "@/lib/db/types";
import { JobInputSchemaType } from "@/lib/job-input";
import {
  AgentJobStatus,
  Job,
  NextJobAction,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

import { BaseService } from "./base.service";
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
}
