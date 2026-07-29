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
  normalizeMasumiPaymentUnit,
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
 * The lowest credits cost among an agent's fixed-priced, purchase-ready V2
 * payment sources. Only purchase-ready sources count — the seller can never
 * validly select an unready one (enforced after start_job), so a cheap
 * unready source must not understate the floor. Sources whose units have no
 * CreditCost row cannot be selected for billing and are skipped; null when
 * no source is priceable.
 */
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
 * A `start_job` call that never produced a usable response. Only the
 * `invalid-response` half strands anything: the seller answered 2xx, so it has
 * accepted the job and begun work, but the body did not match the MIP-003
 * contract and the hire cannot proceed. An `unreachable` seller never started,
 * so it is an ordinary failed hire and stays out of Sentry.
 */
function reportStrandedStartJobFailure(
  failure: AgentJobStartFailure,
  context: Record<string, unknown>,
): void {
  if (failure.kind !== "invalid-response") {
    return;
  }
  reportOrphanedSellerJob(
    "seller accepted start_job but returned a response that does not match the MIP-003 contract",
    { ...context, failure: failure.message },
  );
}

function cheapestEligibleV2SourceCents(
  agentIdentifier: string,
  sources: readonly {
    pricingType: PricingType;
    address: string;
    amounts: { unit: string; amount: bigint }[];
  }[],
  creditCosts: CreditCost[],
  readySources: readonly CardanoV2ReadySource[],
): bigint | null {
  let cheapest: bigint | null = null;
  for (const source of sources) {
    if (
      source.pricingType !== PricingType.FIXED ||
      source.amounts.length === 0 ||
      !isCardanoV2SourceReady(agentIdentifier, source.address, readySources)
    ) {
      continue;
    }
    try {
      const cents = calculateCentsFromMasumiAmountStrings(
        aggregateAmountsByUnit(source.amounts),
        creditCosts,
      );
      if (cheapest === null || cents < cheapest) {
        cheapest = cents;
      }
    } catch {
      // Un-priced source — selecting it fails later anyway.
    }
  }
  return cheapest;
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

  if (
    agentRecord.paymentType !== PaymentType.WEB3_CARDANO_V2 &&
    maxCents !== null &&
    cost.cents > maxCents
  ) {
    throw badRequest("Credit cost exceeds maximum accepted credits");
  }
  // For PAID V2 agents the authoritative cost follows the seller-selected
  // payment source (checked again after start_job), but no valid selection
  // can cost less than the cheapest purchase-ready source — rejecting here
  // avoids orphaning a seller-side job the post-response cap (maxCredits, or
  // the listed price when no cap was given) was always going to refuse.
  // FREE-priced agents take the free flow, which never charges and consults
  // no cap, so the floor must not apply there.
  const isV2Agent =
    agentRecord.paymentType === PaymentType.WEB3_CARDANO_V2 ||
    isV2RegistryIdentifier(agentRecord.blockchainIdentifier);
  if (isV2Agent && agentRecord.pricing.pricingType === PricingType.FIXED) {
    const cheapestCents = cheapestEligibleV2SourceCents(
      agentRecord.blockchainIdentifier,
      agentRecord.paymentSources,
      creditCosts,
      cardanoV2ReadySources,
    );
    const acceptedCeilingCents = maxCents ?? cost.cents;
    if (cheapestCents !== null && cheapestCents > acceptedCeilingCents) {
      throw badRequest(
        maxCents !== null
          ? "Credit cost exceeds maximum accepted credits"
          : "The agent's purchase-ready payment sources exceed its listed price",
      );
    }
  }
  const displayedCostCents = cost.cents;

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
    agentApiBaseUrl:
      masumiAgent.metadataOverride?.apiBaseUrl ?? masumiAgent.apiBaseUrl,
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
  let purchaseAmounts: { unit: string; amount: string }[] | null = null;

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
        throw unprocessableEntity(
          "Paid agent job returned a different agent identifier",
          { reportToSentry: true },
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
        const selectedSource = agent.paymentSources.find(
          (source) =>
            response.supportedPaymentSourceIndex === source.sourceIndex,
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
        // Registry-data defects, not per-request conditions: they recur on
        // every hire of this agent and each attempt strands the seller-side
        // job start_job already accepted, so they must page rather than fail
        // quietly.
        if (
          selectedSource.pricingType !== PricingType.FIXED ||
          selectedSource.amounts.length === 0
        ) {
          throw unprocessableEntity(
            "Paid V2 agent job selected a source without fixed pricing",
            { reportToSentry: true },
          );
        }
        const selectedSourceAmounts = aggregateAmountsByUnit(
          selectedSource.amounts,
        );
        if (selectedSourceAmounts.length > MAX_PAYMENT_NODE_PURCHASE_AMOUNTS) {
          throw unprocessableEntity(
            "Paid V2 agent selected a payment source with too many assets",
            { reportToSentry: true },
          );
        }
        // V2 purchases must always carry the exact source amounts: omitting
        // them lets the node use current on-chain pricing while Sokosumi bills
        // from its registry snapshot.
        purchaseAmounts = selectedSourceAmounts;
        // A unit with no CreditCost row throws here — AFTER start_job. The
        // pre-flight floor check cannot catch it: cheapestEligibleV2SourceCents
        // silently skips un-priceable sources, and both the availability filter
        // and the displayed cost validate only the agent-level pricing, which
        // is projected from a single preferred source.
        try {
          cost = {
            cents: calculateCentsFromMasumiAmountStrings(
              selectedSourceAmounts,
              creditCosts,
            ),
          };
        } catch (error) {
          reportOrphanedSellerJob(
            "selected payment source has no credit cost for its units",
            {
              agentId: agent.id,
              sourceIndex: selectedSource.sourceIndex,
              units: selectedSourceAmounts.map((entry) => entry.unit),
            },
          );
          throw error;
        }
        if (maxCents !== null && cost.cents > maxCents) {
          // Legitimate outcome rather than a defect — the buyer's cap simply
          // refuses the source the seller chose — but it still strands a
          // started job, so it is recorded without paging.
          reportOrphanedSellerJob(
            "selected payment source exceeds the buyer's accepted maximum",
            {
              agentId: agent.id,
              sourceIndex: selectedSource.sourceIndex,
              costCents: cost.cents.toString(),
              maxCents: maxCents.toString(),
            },
            { page: false },
          );
          throw badRequest("Credit cost exceeds maximum accepted credits");
        }
        // Without an explicit maxCredits consent, the seller-selected source
        // must not charge more than the listed agent price.
        if (maxCents === null && cost.cents > displayedCostCents) {
          throw unprocessableEntity(
            "Selected payment source exceeds the agent's listed price",
            { reportToSentry: true },
          );
        }
        paidJobResult = {
          ...response,
          paymentSourceType: "Web3CardanoV2",
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
        purchaseAmounts =
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

    if (!paidJobResult || !identifierFromPurchaser) {
      throw unprocessableEntity("Paid agent job start failed");
    }

    return await createPaidJob(
      { ...jobInput, name: jobName },
      cost,
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
      purchaseAmounts ?? undefined,
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
      // A 4xx from the node is not transient — with the Amounts guard it most
      // likely means on-chain pricing drifted from the synced pricing the
      // credits charge used. Page it; the job follows the payment-failed
      // credit-refund path.
      if (/\(status 4\d\d\)/.test(createPurchaseResult.error)) {
        Sentry.captureException(
          new Error(
            `Purchase rejected by payment node (likely price drift) for agent ${agentInput.agentId}: ${createPurchaseResult.error}`,
          ),
        );
      }
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
