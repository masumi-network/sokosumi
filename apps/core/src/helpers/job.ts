import { AgentJobStatus, JobType, type Prisma } from "@sokosumi/database";
import {
  creditBucketRepository,
  jobShareRepository,
} from "@sokosumi/database/repositories";
import {
  type JobWithEvents,
  jobWithEvents,
  type JobWithPurchase,
  jobWithPurchase,
  type JobWithTransaction,
  jobWithTransaction,
} from "@sokosumi/database/types/job";
import type {
  InputFieldSchemaType,
  StartFreeJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";

import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";
import type { StartPaidJobResponseSchemaType } from "@/schemas/job.schema";
import { flattenJob } from "@/types/job";

import type { AgentCost } from "./agent";
import { badRequest, forbidden, notFound } from "./error";
import { getCredits } from "./user";

/**
 * Validates that user or organization has sufficient credit balance
 */
export async function validateCreditBalance(
  userId: string,
  organizationId: string | null,
  costCents: bigint,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (costCents <= 0) {
    return;
  }

  const centsBalance = await getCredits(userId, organizationId, tx);

  if (centsBalance < costCents) {
    throw badRequest("Insufficient balance");
  }
}

/**
 * Creates a paid job with payment records and consumes credits FIFO
 */
export async function createJobWithPayment(
  input: {
    agentId: string;
    userId: string;
    organizationId: string | null;
    inputData: Record<string, unknown>;
    inputSchema: InputFieldSchemaType[];
    name: string | null;
  },
  cost: AgentCost,
  agentJobResponse: StartPaidJobResponseSchemaType,
  identifierFromPurchaser: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithEvents & JobWithTransaction & JobWithPurchase> {
  // Create transaction first (we need its ID for consumption records)
  const transaction = await tx.transaction.create({
    data: {
      amount: -cost.cents,
      includedFee: cost.includedFee,
      user: { connect: { id: input.userId } },
      ...(input.organizationId && {
        organization: { connect: { id: input.organizationId } },
      }),
    },
  });

  // Consume credits from buckets in FIFO order (this creates CreditConsumption records)
  await creditBucketRepository.consumeCreditsFIFO(
    input.userId,
    input.organizationId,
    cost.cents,
    transaction.id,
    tx,
  );

  // Create job with the transaction
  return await tx.job.create({
    data: {
      agentJobId: agentJobResponse.id,
      jobType: JobType.PAID,
      agent: { connect: { id: input.agentId } },
      user: { connect: { id: input.userId } },
      ...(input.organizationId && {
        organization: { connect: { id: input.organizationId } },
      }),
      events: {
        create: {
          status: AgentJobStatus.INITIATED,
          result: null,
          inputSchema: JSON.stringify(input.inputSchema),
          input: {
            create: {
              input: JSON.stringify(input.inputData),
              inputHash: agentJobResponse.input_hash,
            },
          },
        },
      },
      transaction: { connect: { id: transaction.id } },
      name: input.name,
      payByTime: new Date(agentJobResponse.payByTime),
      externalDisputeUnlockTime: new Date(
        agentJobResponse.externalDisputeUnlockTime,
      ),
      submitResultTime: new Date(agentJobResponse.submitResultTime),
      unlockTime: new Date(agentJobResponse.unlockTime),
      blockchainIdentifier: agentJobResponse.blockchainIdentifier,
      sellerVkey: agentJobResponse.sellerVKey,
      identifierFromPurchaser,
    },
    include: {
      ...jobWithEvents,
      ...jobWithTransaction,
      ...jobWithPurchase,
    },
  });
}

/**
 * Creates a free job
 */
export async function createFreeJob(
  input: {
    agentId: string;
    userId: string;
    organizationId: string | null;
    inputData: Record<string, unknown>;
    inputSchema: InputFieldSchemaType[];
    name: string | null;
  },
  agentJobResponse: StartFreeJobResponseSchemaType,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithEvents & JobWithTransaction & JobWithPurchase> {
  return await tx.job.create({
    data: {
      agentJobId: agentJobResponse.id,
      jobType: JobType.FREE,
      agent: { connect: { id: input.agentId } },
      user: { connect: { id: input.userId } },
      ...(input.organizationId && {
        organization: { connect: { id: input.organizationId } },
      }),
      events: {
        create: {
          status: AgentJobStatus.INITIATED,
          result: null,
          inputSchema: JSON.stringify(input.inputSchema),
          input: {
            create: {
              input: JSON.stringify(input.inputData),
              inputHash: null,
            },
          },
        },
      },
      name: input.name,
      payByTime: null,
      externalDisputeUnlockTime: null,
      submitResultTime: null,
      unlockTime: null,
      blockchainIdentifier: null,
      sellerVkey: null,
      identifierFromPurchaser: null,
    },
    include: {
      ...jobWithEvents,
      ...jobWithTransaction,
      ...jobWithPurchase,
    },
  });
}

/**
 * Shares job with current context (organization if in org context, publicly if personal)
 */
export async function shareJob(
  jobId: string,
  authContext: AuthenticationContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  // Verify job exists and user owns it
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, organizationId: true },
  });

  if (!job) {
    throw notFound("Job not found");
  }

  if (job.userId !== authContext.userId) {
    throw forbidden("You can only share your own jobs");
  }

  if (authContext.organizationId) {
    // Share with organization
    if (job.organizationId !== authContext.organizationId) {
      throw forbidden(
        "Job must belong to the same organization to share with it",
      );
    }

    // Verify user is a member of the organization
    const membership = await tx.member.findUnique({
      where: {
        userId_organizationId: {
          userId: authContext.userId,
          organizationId: authContext.organizationId,
        },
      },
    });

    if (!membership) {
      throw forbidden(
        "You must be a member of the organization to share jobs with it",
      );
    }

    await jobShareRepository.upsertOrganizationShare(
      jobId,
      authContext.organizationId,
      tx,
    );
  } else {
    // Share publicly
    await jobShareRepository.upsertPublicShare(jobId, true, true, tx);
  }
}

/**
 * Retrieves paginated jobs for the authenticated user, optionally filtered by agent ID.
 * Includes all job relations (events, credit transactions, purchases) and returns both jobs and count.
 *
 * @param authContext - The authenticated user context
 * @param options - Query options
 * @param options.agentId - Optional agent ID to filter jobs by
 * @param options.cursor - Optional cursor for pagination
 * @param options.take - Number of items to take
 * @param options.skip - Number of items to skip (used for cursor pagination)
 * @param options.tx - Optional Prisma transaction client for transaction support
 * @returns Object containing flattened jobs array and total count
 *
 * @example
 * // Get paginated jobs for the user
 * const { jobs, count } = await getUserJobs(authContext, { take: 20 });
 *
 * @example
 * // Get paginated jobs for a specific agent with cursor
 * const { jobs, count } = await getUserJobs(authContext, {
 *   agentId: "agent_123",
 *   cursor: "last_job_id",
 *   take: 20,
 *   skip: 1,
 * });
 */
export async function getUserJobs(
  authContext: AuthenticationContext,
  options: {
    agentId?: string;
    cursor?: string;
    take: number;
    skip?: number;
    tx?: Prisma.TransactionClient;
  },
): Promise<{
  jobs: ReturnType<typeof flattenJob>[];
  count: number;
  hasMore: boolean;
}> {
  const { agentId, cursor, take, skip, tx = prisma } = options;

  const where = {
    userId: authContext.userId,
    organizationId: authContext.organizationId,
    ...(agentId ? { agentId } : {}),
  };

  const takePlusOne = take + 1;
  const [jobs, count] = await Promise.all([
    tx.job.findMany({
      where,
      take: takePlusOne,
      skip,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        ...jobWithEvents,
        ...jobWithTransaction,
        ...jobWithPurchase,
      },
    }),
    tx.job.count({ where }),
  ]);
  return {
    jobs: jobs.slice(0, take).map(flattenJob),
    count,
    hasMore: jobs.length === takePlusOne,
  };
}
