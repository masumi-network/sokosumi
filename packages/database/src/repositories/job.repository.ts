import type { InputSchemaSchemaType } from "@sokosumi/masumi/schemas";

import {
  AgentJobStatus,
  JobType,
  OnChainJobStatus,
} from "../generated/prisma/browser.js";
import type { Prisma } from "../generated/prisma/client.js";
import { mapJobWithStatus } from "../helpers/job.js";
import {
  finalizedAgentJobStatuses,
  type JobWithSokosumiStatus,
  jobInclude,
} from "../types/job.js";
import { creditBucketRepository } from "./credit-bucket.repository.js";

interface CreateJobBase {
  agentJobId: string;
  agentId: string;
  ownerId: string;
  organizationId: string | null | undefined;
  workspaceId: string;
  inputSchema: InputSchemaSchemaType;
  input: string;
  inputHash: string | null;
  name: string | null;
  /** Snapshot of the agent endpoint at job start; required for FREE offline sync. */
  agentApiBaseUrl: string | null;
}

interface CreatePaidJobData extends CreateJobBase {
  jobType: typeof JobType.PAID;
  identifierFromPurchaser: string;
  creditsPrice: {
    cents: bigint;
  };
  payByTime: Date;
  externalDisputeUnlockTime: Date;
  submitResultTime: Date;
  unlockTime: Date;
  blockchainIdentifier: string;
  sellerVkey: string;
  purchaseAmounts: { amount: string; unit: string }[];
  purchaseId?: string;
}

interface CreateFreeJobData extends CreateJobBase {
  jobType: typeof JobType.FREE;
}

type CreateJobData = CreatePaidJobData | CreateFreeJobData;

/**
 * Repository for managing Job entities and related queries.
 * Provides methods for retrieving jobs with various filters,
 * creating new jobs, updating job status, and handling job lifecycle operations.
 */
export const jobRepository = {
  async getJobById(
    jobId: string,
    tx: Prisma.TransactionClient,
  ): Promise<JobWithSokosumiStatus | null> {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      include: jobInclude,
    });
    if (!job) {
      return null;
    }
    return mapJobWithStatus(job);
  },

  async createJob(
    data: CreateJobData,
    tx: Prisma.TransactionClient,
  ): Promise<JobWithSokosumiStatus> {
    const inputSchemaSnapshot = JSON.stringify(data.inputSchema);

    const baseJobData: Prisma.JobCreateInput = {
      agentJobId: data.agentJobId,
      jobType: data.jobType,
      agent: {
        connect: {
          id: data.agentId,
        },
      },
      owner: {
        connect: {
          id: data.ownerId,
        },
      },
      ...(data.organizationId && {
        organization: {
          connect: {
            id: data.organizationId,
          },
        },
      }),
      workspace: {
        connect: {
          id: data.workspaceId,
        },
      },
      events: {
        create: {
          status: AgentJobStatus.INITIATED,
          result: null,
          inputSchema: inputSchemaSnapshot,
          input: {
            create: {
              input: data.input,
              inputHash: data.inputHash,
            },
          },
        },
      },

      name: data.name,
      agentApiBaseUrl: data.agentApiBaseUrl,
    };

    switch (data.jobType) {
      case JobType.FREE: {
        const freeJob = await tx.job.create({
          data: {
            ...baseJobData,
            payByTime: null,
            externalDisputeUnlockTime: null,
            submitResultTime: null,
            unlockTime: null,
            blockchainIdentifier: null,
            sellerVkey: null,
            identifierFromPurchaser: null,
          },
          include: jobInclude,
        });
        return mapJobWithStatus(freeJob);
      }
      case JobType.PAID: {
        const consumptions = await creditBucketRepository.prepareConsumption(
          data.ownerId,
          data.organizationId ?? null,
          data.creditsPrice.cents,
          tx,
        );

        const paidJob = await tx.job.create({
          data: {
            ...baseJobData,
            transaction: {
              create: {
                amount: -data.creditsPrice.cents,
                user: {
                  connect: {
                    id: data.ownerId,
                  },
                },
                ...(data.organizationId && {
                  organization: {
                    connect: {
                      id: data.organizationId,
                    },
                  },
                }),
                creditConsumptions: {
                  createMany: {
                    data: consumptions.map((consumption) => ({
                      bucketId: consumption.bucketId,
                      amount: consumption.amount,
                    })),
                  },
                },
              },
            },
            payByTime: data.payByTime,
            externalDisputeUnlockTime: data.externalDisputeUnlockTime,
            submitResultTime: data.submitResultTime,
            unlockTime: data.unlockTime,
            blockchainIdentifier: data.blockchainIdentifier,
            sellerVkey: data.sellerVkey,
            purchaseAmounts: data.purchaseAmounts,
            purchaseAmountMatchRequired: true,
            identifierFromPurchaser: data.identifierFromPurchaser,
          },
          include: jobInclude,
        });
        return mapJobWithStatus(paidJob);
      }
      default: {
        const _exhaustive: never = data;
        throw new Error(`Unsupported job type: ${_exhaustive}`);
      }
    }
  },

  /**
   * Check if user has finished job with the agent
   * @param ownerId - The unique identifier of the job owner
   * @param agentId - The unique identifier of the agent
   * @returns Promise containing true if user has finished job with the agent, false otherwise
   */
  async doesUserHaveFinishedJobWithAgent(
    ownerId: string,
    agentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const jobCount = await tx.job.count({
      where: {
        ownerId,
        agentId,
        ...jobsFinishedWhereQuery(),
      },
    });

    return jobCount > 0;
  },
};

/**
 * Creates a Prisma where query to filter for jobs that still need sync work.
 *
 * Creates a Prisma where query to filter for jobs that are finished.
 * @returns Prisma where query object for filtering finished jobs
 *
 * A job is considered "finished" if it meets any of the following criteria:
 * - AgentJobStatus is either Completed or Failed
 * - OnChainStatus is not FUNDS_LOCKED, REFUND_REQUESTED, or
 *   REFUND_AUTHORIZED (an authorized refund still needs its on-chain
 *   withdrawal), or is null for FREE jobs
 */
function jobsFinishedWhereQuery(): Prisma.JobWhereInput {
  return {
    AND: [
      {
        events: {
          some: {
            status: {
              in: finalizedAgentJobStatuses,
            },
          },
        },
        // Check for finalized on-chain statuses
        OR: [
          { purchase: { onChainStatus: null }, jobType: JobType.FREE },
          {
            purchase: {
              onChainStatus: {
                notIn: [
                  OnChainJobStatus.FUNDS_LOCKED,
                  OnChainJobStatus.REFUND_REQUESTED,
                  OnChainJobStatus.REFUND_AUTHORIZED,
                ],
              },
            },
          },
        ],
      },
    ],
  };
}

// Export types for use in web app
export type { CreateFreeJobData, CreateJobData, CreatePaidJobData };
