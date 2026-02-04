import * as Sentry from "@sentry/node";
import {
  AgentJobStatus,
  JobType,
  PricingType,
  Prisma,
} from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/database/helpers";
import {
  creditBucketRepository,
  jobPurchaseRepository,
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
import { createAgentClient } from "@sokosumi/masumi";
import type {
  InputFieldSchemaType,
  InputSchemaSchemaType,
  InputSchemaType,
  StartFreeJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";
import { v4 as uuidv4 } from "uuid";

import { paymentClient } from "@/clients/masumi-payment.client";
import { openrouterClient } from "@/clients/openrouter.client";
import {
  buildAgentAccessWhereClause,
  getAgentAccessContext,
  getAgentCost,
} from "@/helpers/agent";
import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  flattenInputs,
  type StartPaidJobResponseSchemaType,
} from "@/schemas/job.schema";
import { agentPricingInclude } from "@/types/agent";
import { flattenJob } from "@/types/job";

import type { AgentCost } from "./agent";
import { badRequest, forbidden, notFound, unprocessableEntity } from "./error";
import { transformPurchaseToJobUpdate } from "./purchase";
import { getCents } from "./user";

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

  const centsBalance = await getCents(userId, organizationId, tx);

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
    taskId?: string | null;
  },
  cost: AgentCost,
  agentJobResponse: StartPaidJobResponseSchemaType,
  identifierFromPurchaser: string,
): Promise<JobWithEvents & JobWithTransaction & JobWithPurchase> {
  return await prisma.$transaction(
    async (tx) => {
      const consumptions = await creditBucketRepository.prepareConsumption(
        input.userId,
        input.organizationId,
        cost.cents,
        tx,
      );

      return await tx.job.create({
        data: {
          agentJobId: agentJobResponse.id,
          jobType: JobType.PAID,
          agent: { connect: { id: input.agentId } },
          user: { connect: { id: input.userId } },
          ...(input.organizationId && {
            organization: { connect: { id: input.organizationId } },
          }),
          ...(input.taskId && {
            task: { connect: { id: input.taskId } },
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
          transaction: {
            create: {
              amount: -cost.cents,
              user: { connect: { id: input.userId } },
              ...(input.organizationId && {
                organization: { connect: { id: input.organizationId } },
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
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
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
    taskId?: string | null;
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
      ...(input.taskId && {
        task: { connect: { id: input.taskId } },
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

export async function createAgentJobForUser(input: {
  agentId: string;
  userId: string;
  organizationId: string | null;
  inputData: InputSchemaType;
  inputSchema: InputSchemaSchemaType;
  maxCredits?: number;
  name?: string;
  taskId?: string | null;
}): Promise<JobWithEvents & JobWithTransaction & JobWithPurchase> {
  const flatInputSchema = flattenInputs(input.inputSchema);
  const maxCents = input.maxCredits
    ? convertCreditsToCents(input.maxCredits)
    : null;
  const authContext: AuthenticationContext = {
    userId: input.userId,
    organizationId: input.organizationId,
    orchestratorId: null,
  };

  const agent = await prisma.$transaction(async (tx) => {
    const { userOrganizationIds, creditCosts } = await getAgentAccessContext(
      authContext,
      tx,
    );

    const agent = await tx.agent.findFirst({
      where: {
        id: input.agentId,
        ...buildAgentAccessWhereClause(
          userOrganizationIds,
          authContext.organizationId,
          creditCosts,
        ),
      },
      include: {
        ...agentPricingInclude,
      },
    });

    if (!agent) {
      throw notFound("Agent not found");
    }

    const cost = getAgentCost(agent, creditCosts);

    if (maxCents !== null && cost.cents > maxCents) {
      throw badRequest("Credit cost exceeds maximum accepted credits");
    }

    await validateCreditBalance(
      authContext.userId,
      authContext.organizationId,
      cost.cents,
      tx,
    );

    return { ...agent, cost };
  });

  let jobName = input.name?.trim() || null;
  if (!jobName) {
    const generatedName = await openrouterClient.generateJobName(
      {
        name: agent.name,
        description: agent.description,
      },
      input.inputData,
    );
    jobName = generatedName;
  }

  let job: JobWithEvents & JobWithTransaction & JobWithPurchase;
  switch (agent.pricing.pricingType) {
    case PricingType.FREE: {
      const freeJobResult = await createAgentClient().startFreeAgentJob(
        agent,
        input.inputData,
      );

      if (freeJobResult.isErr()) {
        throw unprocessableEntity(
          `Free agent job start failed: ${freeJobResult.error}`,
        );
      }

      job = await createFreeJob(
        {
          agentId: input.agentId,
          userId: input.userId,
          organizationId: input.organizationId,
          inputData: input.inputData,
          inputSchema: flatInputSchema,
          name: jobName,
          taskId: input.taskId,
        },
        freeJobResult.value,
      );
      break;
    }
    case PricingType.FIXED: {
      const identifierFromPurchaser = uuidv4()
        .replace(/-/g, "")
        .substring(0, 20);

      const paidJobResult = await createAgentClient().startPaidAgentJob(
        {
          id: agent.id,
          name: agent.name,
          blockchainIdentifier: agent.blockchainIdentifier,
          apiBaseUrl: agent.apiBaseUrl,
          overrideApiBaseUrl: agent.overrideApiBaseUrl,
        },
        identifierFromPurchaser,
        input.inputData,
      );

      if (paidJobResult.isErr()) {
        throw unprocessableEntity(
          `Paid agent job start failed: ${paidJobResult.error}`,
        );
      }

      job = await createJobWithPayment(
        {
          agentId: input.agentId,
          userId: input.userId,
          organizationId: input.organizationId,
          inputData: input.inputData,
          inputSchema: flatInputSchema,
          name: jobName,
          taskId: input.taskId,
        },
        agent.cost,
        paidJobResult.value,
        identifierFromPurchaser,
      );

      const createPurchaseResult = await paymentClient().createPurchase(
        agent.blockchainIdentifier,
        paidJobResult.value,
        input.inputData,
        identifierFromPurchaser,
      );

      createPurchaseResult.match(
        (purchase) => {
          const purchaseData = transformPurchaseToJobUpdate(purchase);
          jobPurchaseRepository
            .createJobPurchase(
              {
                jobId: job.id,
                ...purchaseData,
              },
              prisma,
            )
            .catch((error) => {
              Sentry.captureException(error);
            });
        },
        (error) => {
          Sentry.captureException(error);
        },
      );
      break;
    }
    case PricingType.UNKNOWN:
    default:
      throw unprocessableEntity("Agent pricing type not supported");
  }

  return job;
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
