import { AgentJobStatus, JobType, type Prisma } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import {
  creditTransactionRepository,
  jobShareRepository,
} from "@sokosumi/database/repositories";
import {
  type JobWithCreditTransaction,
  jobWithCreditTransaction,
  type JobWithEvents,
  jobWithEvents,
  type JobWithPurchase,
  jobWithPurchase,
} from "@sokosumi/database/types/job";
import type { InputFieldSchemaType } from "@sokosumi/masumi/schemas";

import type { AuthenticationContext } from "@/middleware/auth";
import type { StartPaidJobResponseSchemaType } from "@/schemas/job.schema";
import { flattenJob } from "@/types/job";

import type { AgentCost } from "./agent";
import { badRequest, forbidden, notFound } from "./error";

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

  let centsBalance: bigint;
  if (organizationId) {
    centsBalance = await creditTransactionRepository.getCentsByOrganizationId(
      organizationId,
      tx,
    );
  } else {
    centsBalance = await creditTransactionRepository.getCentsByUserId(
      userId,
      tx,
    );
  }

  if (centsBalance < costCents) {
    throw badRequest("Insufficient balance");
  }
}

/**
 * Creates a paid job with payment records
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
): Promise<JobWithEvents & JobWithCreditTransaction & JobWithPurchase> {
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
      creditTransaction: {
        create: {
          amount: -cost.cents,
          includedFee: cost.includedFee,
          user: { connect: { id: input.userId } },
          ...(input.organizationId && {
            organization: { connect: { id: input.organizationId } },
          }),
        },
      },
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
      ...jobWithCreditTransaction,
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
  agentJobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithEvents & JobWithCreditTransaction & JobWithPurchase> {
  return await tx.job.create({
    data: {
      agentJobId,
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
      ...jobWithCreditTransaction,
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
 * Retrieves jobs for the authenticated user, optionally filtered by agent ID.
 * Includes all job relations (events, credit transactions, purchases) and flattens the results.
 *
 * @param authContext - The authenticated user context
 * @param options - Query options
 * @param options.agentId - Optional agent ID to filter jobs by
 * @param options.tx - Optional Prisma transaction client for transaction support
 * @returns Array of flattened job objects
 *
 * @example
 * // Get all jobs for the user
 * const jobs = await getUserJobs(authContext);
 *
 * @example
 * // Get jobs for a specific agent
 * const jobs = await getUserJobs(authContext, { agentId: "agent_123" });
 *
 * @example
 * // Within a transaction
 * await prisma.$transaction(async (tx) => {
 *   const jobs = await getUserJobs(authContext, { agentId: "agent_123", tx });
 * });
 */
export async function getUserJobs(
  authContext: AuthenticationContext,
  options: {
    agentId?: string;
    tx?: Prisma.TransactionClient;
  } = {},
): Promise<ReturnType<typeof flattenJob>[]> {
  const { agentId, tx = prisma } = options;

  const jobs = await tx.job.findMany({
    where: {
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      ...(agentId ? { agentId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      ...jobWithEvents,
      ...jobWithCreditTransaction,
      ...jobWithPurchase,
    },
  });

  return jobs.map(flattenJob);
}
