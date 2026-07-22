import * as Sentry from "@sentry/node";
import {
  AgentJobStatus,
  agentMetadataOverrideScalarsInclude,
  agentPricingInclude,
  JobType,
  PricingType,
  Prisma,
} from "@sokosumi/database";
import {
  creditBucketRepository,
  jobPurchaseRepository,
} from "@sokosumi/database/repositories";
import {
  type JobWithSummaryRelations,
  jobSummaryInclude,
} from "@sokosumi/database/types/job";
import { createAgentClient } from "@sokosumi/masumi";
import type {
  InputSchemaSchemaType,
  InputSchemaType,
  StartFreeJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";
import { convertCreditsToCents } from "@sokosumi/utils";
import { v4 as uuidv4 } from "uuid";
import { paymentClient } from "@/clients/masumi-payment.client";
import { openrouterClient } from "@/clients/openrouter.client";
import { requireCoworkerCapability } from "@/helpers/access-control";
import {
  buildAvailableAgentWhereClause,
  getAgentCost,
  getCreditCostsOrThrow,
  toMasumiAgent,
} from "@/helpers/agent";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { UserContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import { type StartPaidJobResponseSchemaType } from "@/schemas/job.schema";
import { flattenJob } from "@/types/job";

import type { AgentCost } from "./agent";
import { badRequest, notFound, unprocessableEntity } from "./error";
import { transformPurchaseToJobUpdate } from "./purchase";
import { getCents } from "./user";

export interface JobContext {
  userContext: UserContext;
  workspaceContext: WorkspaceContext;
}

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
    ownerId: string;
    organizationId: string | null;
    workspaceId: string;
    inputData: InputSchemaType;
    inputSchema: InputSchemaSchemaType;
    name: string | null;
    projectId?: string | null;
    taskId?: string | null;
  },
  cost: AgentCost,
  agentJobResponse: StartPaidJobResponseSchemaType,
  identifierFromPurchaser: string,
  tx: Prisma.TransactionClient,
): Promise<JobWithSummaryRelations> {
  const inputSchemaSnapshot = JSON.stringify(input.inputSchema);
  const consumptions = await creditBucketRepository.prepareConsumption(
    input.ownerId,
    input.organizationId,
    cost.cents,
    tx,
  );

  return await tx.job.create({
    data: {
      agentJobId: agentJobResponse.id,
      jobType: JobType.PAID,
      agent: { connect: { id: input.agentId } },
      owner: { connect: { id: input.ownerId } },
      ...(input.organizationId && {
        organization: { connect: { id: input.organizationId } },
      }),
      workspace: { connect: { id: input.workspaceId } },
      ...(input.projectId && {
        project: { connect: { id: input.projectId } },
      }),
      ...(input.taskId && {
        task: { connect: { id: input.taskId } },
      }),
      events: {
        create: {
          status: AgentJobStatus.INITIATED,
          result: null,
          inputSchema: inputSchemaSnapshot,
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
          user: { connect: { id: input.ownerId } },
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
      ...jobSummaryInclude,
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
    ownerId: string;
    organizationId: string | null;
    workspaceId: string;
    inputData: InputSchemaType;
    inputSchema: InputSchemaSchemaType;
    name: string | null;
    projectId?: string | null;
    taskId?: string | null;
  },
  agentJobResponse: StartFreeJobResponseSchemaType,
  tx: Prisma.TransactionClient,
): Promise<JobWithSummaryRelations> {
  const inputSchemaSnapshot = JSON.stringify(input.inputSchema);
  return await tx.job.create({
    data: {
      agentJobId: agentJobResponse.id,
      jobType: JobType.FREE,
      agent: { connect: { id: input.agentId } },
      owner: { connect: { id: input.ownerId } },
      ...(input.organizationId && {
        organization: { connect: { id: input.organizationId } },
      }),
      workspace: { connect: { id: input.workspaceId } },
      ...(input.projectId && {
        project: { connect: { id: input.projectId } },
      }),
      ...(input.taskId && {
        task: { connect: { id: input.taskId } },
      }),
      events: {
        create: {
          status: AgentJobStatus.INITIATED,
          result: null,
          inputSchema: inputSchemaSnapshot,
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
      ...jobSummaryInclude,
    },
  });
}

interface CreateAgentJobInput {
  owner: JobOwnerContext;
  agentInput: {
    agentId: string;
    inputData: InputSchemaType;
    inputSchema: InputSchemaSchemaType;
    maxCredits?: number;
    maxAcceptedCents?: bigint;
    name?: string;
    projectId?: string | null;
  };
  taskContext?: {
    taskId: string;
  };
}

export interface JobOwnerContext {
  ownerId: string;
  organizationId: string | null;
  workspaceId: string;
}

export async function createAgentJobForUser(
  input: CreateAgentJobInput,
): Promise<JobWithSummaryRelations> {
  const { owner, agentInput, taskContext } = input;
  const maxCents =
    agentInput.maxAcceptedCents ??
    (agentInput.maxCredits
      ? convertCreditsToCents(agentInput.maxCredits)
      : null);

  const creditCosts = await getCreditCostsOrThrow();

  const agentRecord = await prisma.agent.findFirst({
    where: {
      id: agentInput.agentId,
      ...buildAvailableAgentWhereClause(creditCosts),
    },
    include: {
      ...agentPricingInclude,
      ...agentMetadataOverrideScalarsInclude,
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

  if (agentInput.projectId !== null && agentInput.projectId !== undefined) {
    const project = await prisma.project.findFirst({
      where: {
        id: agentInput.projectId,
        workspaceId: owner.workspaceId,
      },
      select: { id: true },
    });

    if (!project) {
      throw notFound("Project not found");
    }
  }

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
    jobName = generatedName?.trim() || null;
    return jobName;
  };

  const jobInput = {
    agentId: agentInput.agentId,
    ownerId: owner.ownerId,
    organizationId: owner.organizationId,
    workspaceId: owner.workspaceId,
    inputData: agentInput.inputData,
    inputSchema: agentInput.inputSchema,
    projectId: agentInput.projectId,
    taskId: taskContext?.taskId,
  };

  let paidJobResult: StartPaidJobResponseSchemaType | null = null;
  let freeJobResult: StartFreeJobResponseSchemaType | null = null;
  let identifierFromPurchaser: string | null = null;

  const masumiAgent = toMasumiAgent(agent);

  switch (agent.pricing.pricingType) {
    case PricingType.FREE: {
      const startFreeJobResult = await createAgentClient().startFreeAgentJob(
        masumiAgent,
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
        masumiAgent,
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

  const job = await serializableTransaction(async (tx) => {
    await validateCreditBalance(
      owner.ownerId,
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
  }, "Job creation conflicted with a concurrent request. Please retry.");

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
      // Job already exists; purchase registration is retried by job sync. A
      // transient Masumi payment outage should not page Sentry (SOKOSUMI-CORE-2N).
      console.warn("[createAgentJobForUser] purchase registration failed", {
        jobId: job.id,
        agentId: agentInput.agentId,
        error: createPurchaseResult.error,
      });
    }
  }

  return job;
}

/**
 * Retrieves paginated jobs for the authenticated user, optionally filtered by agent ID.
 * Includes all job relations (events, credit transactions, purchases) and returns both jobs and count.
 *
 * @param context - The authenticated user and workspace context
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
 * const { jobs, count } = await getUserJobs({
 *   userContext,
 *   workspaceContext,
 * }, {
 *   take: 20,
 * });
 *
 * @example
 * // Get paginated jobs for a specific agent with cursor
 * const { jobs, count } = await getUserJobs({
 *   userContext,
 *   workspaceContext,
 * }, {
 *   agentId: "agent_123",
 *   cursor: "last_job_id",
 *   take: 20,
 *   skip: 1,
 * });
 */
export async function getUserJobs(
  context: JobContext,
  options: {
    agentId?: string;
    projectId?: string | null;
    status?: AgentJobStatus;
    scope?: "workspace" | "owned";
    coworkerId?: string;
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
  const {
    agentId,
    projectId,
    status,
    scope = "owned",
    coworkerId,
    cursor,
    take,
    skip,
    tx = prisma,
  } = options;
  const { userContext, workspaceContext } = context;

  // A delegated coworker may only list jobs whose task is assigned to it.
  if (coworkerId) {
    await requireCoworkerCapability(coworkerId, "tasks", tx);
  }

  const where: Prisma.JobWhereInput = {
    AND: [
      {
        workspaceId: workspaceContext.workspaceId,
        ...(scope === "owned" ? { ownerId: userContext.userId } : {}),
      },
      ...(agentId ? [{ agentId }] : []),
      ...(projectId !== undefined ? [{ projectId }] : []),
      ...(status ? [{ events: { some: { status: { equals: status } } } }] : []),
      // `task` is an optional to-one relation, so this filter requires the job
      // to HAVE a task assigned to this coworker — null-task jobs are excluded.
      ...(coworkerId ? [{ task: { assigneeId: coworkerId } }] : []),
    ],
  };

  const takePlusOne = take + 1;
  const jobs = await tx.job.findMany({
    where,
    take: takePlusOne,
    skip,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      ...jobSummaryInclude,
    },
  });
  const count = await tx.job.count({ where });
  return {
    jobs: jobs.slice(0, take).map(flattenJob),
    count,
    hasMore: jobs.length === takePlusOne,
  };
}
