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
  buildAvailableAgentWhereClause,
  getAgentCost,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import prisma from "@/lib/db/prisma";
import type { UserAuthenticationContext } from "@/middleware/auth";
import {
  flattenInputs,
  type StartPaidJobResponseSchemaType,
} from "@/schemas/job.schema";
import { agentPricingInclude } from "@/types/agent";
import { flattenJob } from "@/types/job";

import type { AgentCost } from "./agent";
import { badRequest, forbidden, notFound, unprocessableEntity } from "./error";
import { transformPurchaseToJobUpdate } from "./purchase";
import { buildJobScopeFilters, type JobScope } from "./scope";
import { getCents } from "./user";

/**
 * Validates that user or organization has sufficient credit balance
 */
async function validateCreditBalance(
  userId: string,
  organizationId: string | null,
  costCents: bigint,
  tx: Prisma.TransactionClient,
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
 * Creates a paid job (payment records and credit consumption FIFO).
 * Requires a transaction client so the caller controls the transaction boundary.
 */
async function createPaidJob(
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
  tx: Prisma.TransactionClient,
): Promise<JobWithEvents & JobWithTransaction & JobWithPurchase> {
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
}

/**
 * Creates a free job.
 * Requires a transaction client so the caller controls the transaction boundary.
 */
async function createFreeJob(
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
  tx: Prisma.TransactionClient,
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
  authContext: UserAuthenticationContext,
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

interface CreateAgentJobInput {
  owner: CreateAgentJobOwner;
  agentInput: {
    agentId: string;
    inputData: InputSchemaType;
    inputSchema: InputSchemaSchemaType;
    maxCredits?: number;
    name?: string;
  };
  taskContext?: {
    taskId: string;
  };
}

export interface CreateAgentJobOwner {
  userId: string;
  organizationId: string | null;
}

export async function createAgentJobForUser(
  input: CreateAgentJobInput,
): Promise<JobWithEvents & JobWithTransaction & JobWithPurchase> {
  const { owner, agentInput, taskContext } = input;
  const flatInputSchema = flattenInputs(agentInput.inputSchema);
  const maxCents = agentInput.maxCredits
    ? convertCreditsToCents(agentInput.maxCredits)
    : null;

  const creditCosts = await getCreditCostsOrThrow();

  const agentRecord = await prisma.agent.findFirst({
    where: {
      id: agentInput.agentId,
      ...buildAvailableAgentWhereClause(creditCosts),
    },
    include: {
      ...agentPricingInclude,
    },
  });

  if (!agentRecord) {
    throw notFound("Agent not found");
  }

  const cost = getAgentCost(agentRecord, creditCosts);

  if (maxCents !== null && cost.cents > maxCents) {
    throw badRequest("Credit cost exceeds maximum accepted credits");
  }

  const agent = { ...agentRecord, cost };

  let jobName = agentInput.name?.trim() || null;
  const resolveJobName = async (): Promise<string | null> => {
    if (jobName) {
      return jobName;
    }

    const generatedName = await openrouterClient.generateJobName(
      {
        name: agent.name,
        description: agent.description,
      },
      agentInput.inputData,
    );
    jobName = generatedName;
    return jobName;
  };

  const jobInput = {
    agentId: agentInput.agentId,
    userId: owner.userId,
    organizationId: owner.organizationId,
    inputData: agentInput.inputData,
    inputSchema: flatInputSchema,
    taskId: taskContext?.taskId,
  };

  let paidJobResult: StartPaidJobResponseSchemaType | null = null;
  let freeJobResult: StartFreeJobResponseSchemaType | null = null;
  let identifierFromPurchaser: string | null = null;

  switch (agent.pricing.pricingType) {
    case PricingType.FREE: {
      const startFreeJobResult = await createAgentClient().startFreeAgentJob(
        agent,
        agentInput.inputData,
      );

      if (startFreeJobResult.isErr()) {
        throw unprocessableEntity(
          `Free agent job start failed: ${startFreeJobResult.error}`,
        );
      }

      await resolveJobName();
      freeJobResult = startFreeJobResult.value;
      break;
    }
    case PricingType.FIXED: {
      identifierFromPurchaser = uuidv4().replace(/-/g, "").substring(0, 20);

      const startPaidJobResult = await createAgentClient().startPaidAgentJob(
        {
          id: agent.id,
          name: agent.name,
          blockchainIdentifier: agent.blockchainIdentifier,
          apiBaseUrl: agent.apiBaseUrl,
          overrideApiBaseUrl: agent.overrideApiBaseUrl,
        },
        identifierFromPurchaser,
        agentInput.inputData,
      );

      if (startPaidJobResult.isErr()) {
        throw unprocessableEntity(
          `Paid agent job start failed: ${startPaidJobResult.error}`,
        );
      }

      await resolveJobName();
      paidJobResult = startPaidJobResult.value;
      break;
    }
    case PricingType.UNKNOWN:
    default:
      throw unprocessableEntity("Agent pricing type not supported");
  }

  const job = await prisma.$transaction(
    async (tx) => {
      await validateCreditBalance(
        owner.userId,
        owner.organizationId,
        cost.cents,
        tx,
      );

      if (agent.pricing.pricingType === PricingType.FREE) {
        if (!freeJobResult) {
          throw unprocessableEntity("Free agent job start failed");
        }

        return await createFreeJob(
          { ...jobInput, name: jobName },
          freeJobResult,
          tx,
        );
      }

      if (!paidJobResult || !identifierFromPurchaser) {
        throw unprocessableEntity("Paid agent job start failed");
      }

      return await createPaidJob(
        { ...jobInput, name: jobName },
        agent.cost,
        paidJobResult,
        identifierFromPurchaser,
        tx,
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );

  if (
    agent.pricing.pricingType === PricingType.FIXED &&
    paidJobResult &&
    identifierFromPurchaser
  ) {
    const createPurchaseResult = await paymentClient().createPurchase(
      agent.blockchainIdentifier,
      paidJobResult,
      agentInput.inputData,
      identifierFromPurchaser,
    );

    if (createPurchaseResult.isOk()) {
      const purchaseData = transformPurchaseToJobUpdate(
        createPurchaseResult.value,
      );
      await jobPurchaseRepository
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
    } else {
      Sentry.captureException(createPurchaseResult.error);
    }
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
  authContext: UserAuthenticationContext,
  options: {
    agentId?: string;
    cursor?: string;
    take: number;
    skip?: number;
    scopes?: JobScope[];
    tx?: Prisma.TransactionClient;
  },
): Promise<{
  jobs: ReturnType<typeof flattenJob>[];
  count: number;
  hasMore: boolean;
}> {
  const { agentId, cursor, take, skip, scopes, tx = prisma } = options;

  const scopeFilters = buildJobScopeFilters(authContext, scopes);
  if (scopeFilters.length === 0) {
    return {
      jobs: [],
      count: 0,
      hasMore: false,
    };
  }

  const where: Prisma.JobWhereInput = {
    OR: scopeFilters,
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
