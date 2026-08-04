import * as Sentry from "@sentry/node";
import {
  AgentJobStatus,
  agentMetadataOverrideScalarsInclude,
  agentPricingInclude,
  type CreditCost,
  JobType,
  PaymentType,
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
import {
  type AgentJobStartFailure,
  createAgentClient,
  isV2RegistryIdentifier,
  normalizeMasumiPaymentUnit,
  normalizeV2RegistryIdentifier,
} from "@sokosumi/masumi";
import type {
  InputSchemaSchemaType,
  InputSchemaType,
  StartFreeJobResponseSchemaType,
  StartPaidJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";
import { convertCreditsToCents } from "@sokosumi/utils";
import { v4 as uuidv4 } from "uuid";
import { paymentClient } from "@/clients/masumi-payment.client";
import { openrouterClient } from "@/clients/openrouter.client";
import { getEnv } from "@/config/env";
import { requireCoworkerCapability } from "@/helpers/access-control";
import {
  buildAvailableAgentWhereClause,
  type CardanoV2ReadySource,
  calculateCentsFromMasumiAmountStrings,
  getAgentCost,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
  isCardanoV2SourceReady,
  toMasumiAgent,
} from "@/helpers/agent";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { UserContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
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
    agentBlockchainIdentifier: string;
    agentApiBaseUrl: string;
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
  purchaseAmounts: { amount: string; unit: string }[],
  // Only true when these amounts were also sent to the payment node as the
  // drift guard. When the guard is omitted (legacy V1 metadata with more
  // amounts than POST /purchase accepts) the node may lock a drifted price, so
  // requiring an exact match would make the job-sync backfill refuse the
  // purchase forever instead of reconciling it.
  purchaseAmountMatchRequired: boolean,
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
      agentBlockchainIdentifier: input.agentBlockchainIdentifier,
      agentApiBaseUrl: input.agentApiBaseUrl,
      paymentSourceType: agentJobResponse.paymentSourceType,
      supportedPaymentSourceIndex: agentJobResponse.supportedPaymentSourceIndex,
      purchaseAmounts,
      purchaseAmountMatchRequired,
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
    agentBlockchainIdentifier: string;
    agentApiBaseUrl: string;
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
      agentBlockchainIdentifier: input.agentBlockchainIdentifier,
      agentApiBaseUrl: input.agentApiBaseUrl,
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

const MAX_PAYMENT_NODE_PURCHASE_AMOUNTS = 7;

/**
 * Records that a hire failed AFTER `start_job` was accepted, so the seller is
 * doing work for a job Sokosumi will never track. MIP-003 has no cancel, so
 * there is nothing to compensate with — the only remedy is visibility.
 *
 * `page: false` for outcomes that are legitimate rather than defects (a buyer
 * cap refusing the seller's chosen source); everything else is a registry-data
 * or protocol defect that recurs on every hire of the agent.
 */
function reportOrphanedSellerJob(
  reason: string,
  context: Record<string, unknown>,
  options: { page?: boolean } = {},
): void {
  const message = `Seller-side job orphaned after start_job: ${reason}`;
  console.error(`[createAgentJobForUser] ${message}`, context);
  if (options.page !== false) {
    Sentry.captureException(new Error(message), { extra: context });
  }
}

/**
 * A `start_job` call that never produced a usable response. Invalid 2xx bodies
 * definitely strand seller work; transport failures after dispatch may strand
 * it. Both page because MIP-003 has no reconciliation or cancel endpoint.
 * Pre-dispatch validation and explicit non-timeout 4xx failures stay ordinary.
 */
function reportStrandedStartJobFailure(
  failure: AgentJobStartFailure,
  context: Record<string, unknown>,
): void {
  if (failure.kind === "unreachable") {
    return;
  }
  const reason =
    failure.kind === "ambiguous"
      ? "start_job transport failed after dispatch; seller acceptance is unknown"
      : "seller accepted start_job but returned a response that does not match the MIP-003 contract";
  reportOrphanedSellerJob(reason, { ...context, failure: failure.message });
}

interface PreparedV2Source {
  amounts: { unit: string; amount: string }[];
  cents: bigint;
}

function prepareEligibleV2Sources(
  agentIdentifier: string,
  sources: readonly {
    sourceIndex: number;
    pricingType: PricingType;
    address: string;
    amounts: { unit: string; amount: bigint }[];
  }[],
  creditCosts: CreditCost[],
  readySources: readonly CardanoV2ReadySource[],
  acceptedCeilingCents: bigint,
  hasExplicitCeiling: boolean,
): Map<number, PreparedV2Source> {
  const prepared = new Map<number, PreparedV2Source>();
  for (const source of sources) {
    if (
      !isCardanoV2SourceReady(agentIdentifier, source.address, readySources)
    ) {
      continue;
    }
    if (
      source.pricingType !== PricingType.FIXED ||
      source.amounts.length === 0
    ) {
      throw unprocessableEntity(
        "Paid V2 agent has a purchase-ready source without fixed pricing",
        { reportToSentry: true },
      );
    }
    const amounts = aggregateAmountsByUnit(source.amounts);
    if (amounts.length > MAX_PAYMENT_NODE_PURCHASE_AMOUNTS) {
      throw unprocessableEntity(
        "Paid V2 agent has a purchase-ready source with too many assets",
        { reportToSentry: true },
      );
    }
    let cents: bigint;
    try {
      cents = calculateCentsFromMasumiAmountStrings(amounts, creditCosts);
    } catch {
      throw unprocessableEntity(
        "Paid V2 agent has a purchase-ready source with unbillable units",
        { reportToSentry: true },
      );
    }
    if (cents > acceptedCeilingCents) {
      if (hasExplicitCeiling) {
        throw badRequest("Credit cost exceeds maximum accepted credits");
      }
      throw unprocessableEntity(
        "The agent's purchase-ready payment sources exceed its listed price",
        { reportToSentry: true },
      );
    }
    prepared.set(source.sourceIndex, { amounts, cents });
  }
  return prepared;
}

/**
 * Sums pricing rows per unit. The payment node compares Amounts as per-unit
 * sums and caps the array at 7 entries, so duplicate-unit registrations must
 * be aggregated before sending.
 */
function aggregateAmountsByUnit(
  rows: readonly { unit: string; amount: bigint }[],
): { unit: string; amount: string }[] {
  const sums = new Map<string, bigint>();
  for (const row of rows) {
    const unit = normalizeMasumiPaymentUnit(row.unit);
    sums.set(unit, (sums.get(unit) ?? 0n) + row.amount);
  }
  return Array.from(sums, ([unit, amount]) => ({
    unit,
    amount: amount.toString(),
  }));
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
  const cardanoV2ReadySources = await getCardanoV2ReadySources();

  const agentRecord = await prisma.agent.findFirst({
    where: {
      id: agentInput.agentId,
      ...buildAvailableAgentWhereClause(creditCosts, cardanoV2ReadySources),
    },
    include: {
      ...agentPricingInclude,
      ...agentMetadataOverrideScalarsInclude,
      paymentSources: {
        where: {
          chain: "Cardano",
          network: getEnv().NETWORK,
          paymentSourceType: "Web3CardanoV2",
        },
        include: {
          amounts: true,
        },
        orderBy: { sourceIndex: "asc" },
      },
    },
  });

  if (!agentRecord) {
    throw notFound("Agent not found");
  }

  let cost = getAgentCost(agentRecord, creditCosts);
  const isV2Agent =
    agentRecord.paymentType === PaymentType.WEB3_CARDANO_V2 ||
    isV2RegistryIdentifier(agentRecord.blockchainIdentifier);

  if (!isV2Agent && maxCents !== null && cost.cents > maxCents) {
    throw badRequest("Credit cost exceeds maximum accepted credits");
  }
  let preparedV2Sources = new Map<number, PreparedV2Source>();
  if (isV2Agent && agentRecord.pricing.pricingType === PricingType.FIXED) {
    preparedV2Sources = prepareEligibleV2Sources(
      agentRecord.blockchainIdentifier,
      agentRecord.paymentSources,
      creditCosts,
      cardanoV2ReadySources,
      maxCents ?? cost.cents,
      maxCents !== null,
    );
  }

  const agent = agentRecord;

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

  const masumiAgent = toMasumiAgent(agent);
  const jobInput = {
    agentId: agentInput.agentId,
    agentBlockchainIdentifier: masumiAgent.blockchainIdentifier,
    agentApiBaseUrl: masumiAgent.apiBaseUrl,
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
  let expectedPurchaseAmounts: { unit: string; amount: string }[] | null = null;
  let purchaseRequestAmounts: { unit: string; amount: string }[] | null = null;

  switch (agent.pricing.pricingType) {
    case PricingType.FREE: {
      const startFreeJobResult = await createAgentClient().startFreeAgentJob(
        masumiAgent,
        agentInput.inputData,
      );

      if (startFreeJobResult.isErr()) {
        reportStrandedStartJobFailure(startFreeJobResult.error, {
          agentId: agent.id,
          pricingType: PricingType.FREE,
        });
        throw unprocessableEntity(
          `Free agent job start failed: ${startFreeJobResult.error.message}`,
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
        reportStrandedStartJobFailure(startPaidJobResult.error, {
          agentId: agent.id,
          pricingType: PricingType.FIXED,
        });
        throw unprocessableEntity(
          `Paid agent job start failed: ${startPaidJobResult.error.message}`,
        );
      }

      const response = startPaidJobResult.value;
      // Stored V2 identifiers are normalized to lowercase at ingestion, so
      // compare case-insensitively — a seller echoing uppercase hex is the
      // same agent, and rejecting it here would orphan the job it just
      // started.
      if (
        normalizeV2RegistryIdentifier(response.agentIdentifier) !==
        agent.blockchainIdentifier
      ) {
        reportOrphanedSellerJob(
          "seller returned a different agent identifier",
          {
            agentId: agent.id,
            agentJobId: response.id,
            expectedAgentIdentifier: agent.blockchainIdentifier,
            receivedAgentIdentifier: response.agentIdentifier,
          },
        );
        throw unprocessableEntity(
          "Paid agent job returned a different agent identifier",
        );
      }

      // The purchaser nonce is ours; the node derives the on-chain identifier
      // from it, so a seller echoing a different one would only fail at
      // purchase creation — after credits are consumed.
      if (response.identifierFromPurchaser !== identifierFromPurchaser) {
        throw unprocessableEntity(
          "Paid agent job returned a different purchaser identifier",
          { reportToSentry: true },
        );
      }

      // Keyed on identifier as well as payment type: free and EVM-only V2
      // agents report "None" yet still settle through a V2 contract, and the
      // availability filter admits them on the same basis.
      if (isV2Agent) {
        // A seller that omits the index is only unambiguous when the agent
        // registered exactly ONE payment source for this rail and network:
        // there is nothing else it could have meant. With several sources the
        // seller alone knows which one it will settle through, so the echo
        // stays mandatory — guessing would bill from the wrong price.
        const selectedSourceIndex =
          response.supportedPaymentSourceIndex ??
          (agent.paymentSources.length === 1
            ? agent.paymentSources[0]?.sourceIndex
            : undefined);
        const selectedSource = agent.paymentSources.find(
          (source) => selectedSourceIndex === source.sourceIndex,
        );
        if (!selectedSource) {
          throw unprocessableEntity(
            "Paid V2 agent job returned an unexpected payment source",
            { reportToSentry: true },
          );
        }
        const isSelectedSourcePurchaseReady = isCardanoV2SourceReady(
          agent.blockchainIdentifier,
          selectedSource.address,
          cardanoV2ReadySources,
        );
        if (!isSelectedSourcePurchaseReady) {
          throw unprocessableEntity(
            "Paid V2 agent job selected a payment source that is not purchase-ready",
            { reportToSentry: true },
          );
        }
        if (
          response.paymentSourceType !== undefined &&
          response.paymentSourceType !== "Web3CardanoV2"
        ) {
          throw unprocessableEntity(
            "Paid V2 agent job returned an invalid payment source type",
            { reportToSentry: true },
          );
        }
        const preparedSource = preparedV2Sources.get(
          selectedSource.sourceIndex,
        );
        if (!preparedSource) {
          throw unprocessableEntity(
            "Paid V2 agent job selected an ineligible payment source",
            { reportToSentry: true },
          );
        }
        // V2 purchases must always carry the exact source amounts: omitting
        // them lets the node use current on-chain pricing while Sokosumi bills
        // from its registry snapshot.
        expectedPurchaseAmounts = preparedSource.amounts;
        purchaseRequestAmounts = preparedSource.amounts;
        cost = { cents: preparedSource.cents };
        paidJobResult = {
          ...response,
          paymentSourceType: "Web3CardanoV2",
          // Forward the RESOLVED index, not the seller's echo. The node feeds
          // this straight back into the signed blockchainIdentifier payload,
          // where an omitted index and an explicit one hash differently — so
          // sending undefined for a source the seller signed with an index
          // would fail signature verification at POST /purchase.
          supportedPaymentSourceIndex: selectedSource.sourceIndex,
        };
      } else {
        // A V1 agent whose seller upgraded its SDK may now echo V2-shaped
        // fields. main ignored them and hired successfully, so rejecting here
        // would break those agents mid-rollout — and only AFTER start_job has
        // orphaned a seller-side job. Record the mismatch and continue on the
        // V1 rail, which is what the stored agent says this purchase is.
        if (
          (response.paymentSourceType !== undefined &&
            response.paymentSourceType !== "Web3CardanoV1") ||
          response.supportedPaymentSourceIndex !== undefined
        ) {
          console.warn(
            "[createAgentJobForUser] legacy agent returned V2 payment fields; ignoring",
            {
              agentId: agent.id,
              paymentSourceType: response.paymentSourceType,
              supportedPaymentSourceIndex: response.supportedPaymentSourceIndex,
            },
          );
        }
        // Price-drift guard: pass the exact amounts the credits charge was
        // computed from; the node rejects the purchase if the agent's
        // on-chain pricing has drifted from what we synced.
        const fixedPricingAmounts = agent.pricing.fixedPricing
          ? aggregateAmountsByUnit(agent.pricing.fixedPricing.amounts)
          : [];
        // Legacy V1 metadata permits more entries than POST /purchase accepts.
        // Preserve those agents' old behavior by omitting the optional drift
        // guard until the node's request limit is widened.
        expectedPurchaseAmounts = fixedPricingAmounts;
        purchaseRequestAmounts =
          fixedPricingAmounts.length <= MAX_PAYMENT_NODE_PURCHASE_AMOUNTS
            ? fixedPricingAmounts
            : null;
        // Strip the ignored V2 fields so the job row records the rail it was
        // actually created on rather than what the seller happened to echo.
        paidJobResult = {
          ...response,
          // Record the rail this job actually settles on. Writing undefined
          // persisted NULL, which silently disabled the backfill's rail check.
          paymentSourceType: "Web3CardanoV1" as const,
          supportedPaymentSourceIndex: undefined,
        };
      }

      await resolveJobName();
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

    if (
      !paidJobResult ||
      !identifierFromPurchaser ||
      !expectedPurchaseAmounts
    ) {
      throw unprocessableEntity("Paid agent job start failed");
    }

    return await createPaidJob(
      { ...jobInput, name: jobName },
      cost,
      paidJobResult,
      identifierFromPurchaser,
      expectedPurchaseAmounts,
      purchaseRequestAmounts !== null,
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
      purchaseRequestAmounts ?? undefined,
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
      // A permanent rejection is not transient — with the Amounts guard it
      // most likely means on-chain pricing drifted from the synced pricing the
      // credits charge used. Page it; the job follows the payment-failed
      // credit-refund path.
      if (createPurchaseResult.error.kind === "permanent") {
        Sentry.captureException(
          new Error(
            `Purchase rejected by payment node (likely price drift) for agent ${agentInput.agentId}: ${createPurchaseResult.error.message}`,
          ),
        );
      }
      // Job already exists; purchase registration is retried by job sync. A
      // transient Masumi payment outage should not page Sentry (SOKOSUMI-CORE-2N).
      console.warn("[createAgentJobForUser] purchase registration failed", {
        jobId: job.id,
        agentId: agentInput.agentId,
        error: createPurchaseResult.error.message,
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
