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

interface CreateDemoJobData {
  jobType: typeof JobType.DEMO;
  agentJobId: string;
  agentId: string;
  userId: string;
  organizationId?: string | null;
  workspaceId: string;
  inputSchema: InputSchemaSchemaType;
  input: string;
  name: string | null;
  result?: string | null;
}

interface CreateJobBase {
  agentJobId: string;
  agentId: string;
  userId: string;
  organizationId: string | null | undefined;
  workspaceId: string;
  inputSchema: InputSchemaSchemaType;
  input: string;
  inputHash: string | null;
  name: string | null;
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

  async createDemoJob(
    data: CreateDemoJobData,
    tx: Prisma.TransactionClient,
  ): Promise<JobWithSokosumiStatus> {
    const inputSchemaSnapshot = JSON.stringify(data.inputSchema);

    const job = await tx.job.create({
      data: {
        agentJobId: data.agentJobId,
        jobType: JobType.DEMO,
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
              },
            },
          },
        },
        payByTime: null,
        submitResultTime: null,
        unlockTime: null,
        externalDisputeUnlockTime: null,
        blockchainIdentifier: null,
        sellerVkey: null,
        name: data.name,
      },
      include: jobInclude,
    });

    const updatedJob = await tx.job.update({
      where: { id: job.id },
      data: {
        events: {
          create: {
            status: AgentJobStatus.COMPLETED,
            result: data.result,
          },
        },
      },
      include: jobInclude,
    });
    return mapJobWithStatus(updatedJob);
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
          data.userId,
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
   * @param userId - The unique identifier of the user
   * @param agentId - The unique identifier of the agent
   * @returns Promise containing true if user has finished job with the agent, false otherwise
   */
  async doesUserHaveFinishedJobWithAgent(
    userId: string,
    agentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const jobCount = await tx.job.count({
      where: {
        userId,
        agentId,
        jobType: {
          not: JobType.DEMO,
        },
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
 * - OnChainStatus is not FUNDS_LOCKED or REFUND_REQUESTED
 *   or is null for FREE jobs
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
export type {
  CreateDemoJobData,
  CreateFreeJobData,
  CreateJobData,
  CreatePaidJobData,
};
