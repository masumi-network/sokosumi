import * as Sentry from "@sentry/node";
import {
  AgentJobStatus,
  type Job,
  JobType,
  PricingType,
  Prisma,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import type { CreditBucketProjectOption } from "@sokosumi/database/helpers";
import { InsufficientBalanceError } from "@sokosumi/database/repositories";
import { netType, sharedTable } from "@sokosumi/database/sql-tables";
import {
  type JobWithListSummaryRelations,
  jobListSummaryInclude,
} from "@sokosumi/database/types/job";
import {
  type AgentJobStartFailure,
  createAgentClient,
  normalizeV2RegistryIdentifier,
  toMasumiPaymentNodeAmounts,
} from "@sokosumi/masumi";
import type {
  InputSchemaSchemaType,
  InputSchemaType,
  StartFreeJobResponseSchemaType,
  StartPaidJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";
import { convertCreditsToCents } from "@sokosumi/utils";
import { v4 as uuidv4 } from "uuid";
import { openrouterClient } from "@/clients/openrouter.client";
import { requireCoworkerCapability } from "@/helpers/access-control";
import { isCardanoV2SourceReady, toMasumiAgent } from "@/helpers/agent";
import { notifyLowBalanceAfterCharge } from "@/helpers/billing-notifications";
import { registerJobPurchase } from "@/helpers/job-purchase-registration";
import { requireOwnerSeat } from "@/helpers/owner-seat";
import { creatorFields, type WorkCreator } from "@/helpers/work-creator";
import {
  aggregateAmountsByUnit,
  isV2HireAgent,
  MAX_PAYMENT_NODE_PURCHASE_AMOUNTS,
  requireAgentForHire,
} from "@/lib/agent-catalog/hire";
import { getBalance } from "@/lib/credits/balance";
import { spend } from "@/lib/credits/spend";
import {
  createNetworkScope,
  type NetworkScope,
  networkUsesSharedSchema,
  type SharedDb,
} from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { recordCoreError, recordCoreWarning } from "@/lib/evlog";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  isSokoBotAuthContext,
  type UserContext,
} from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import { flattenJob } from "@/types/job";

import type { AgentCost } from "./agent-cost";
import {
  badRequest,
  internalServerError,
  notFound,
  unprocessableEntity,
} from "./error";
import {
  buildCoworkerJobParentTaskSql,
  buildCoworkerJobParentTaskWhere,
  buildHumanJobParentVisibilitySql,
  buildHumanJobParentVisibilityWhere,
} from "./task-visibility";

export interface JobContext {
  userContext: UserContext;
  workspaceContext: WorkspaceContext;
}

/**
 * Validates that user or organization has sufficient credit balance.
 * `projectId` is the Project the charge will carry: its Project credits
 * count, then the pool. None sees only the pool (ADR 0067).
 */
async function validateCreditBalance(
  userId: string | null,
  organizationId: string | null,
  costCents: bigint,
  tx: Prisma.TransactionClient,
  options: CreditBucketProjectOption = {},
): Promise<void> {
  if (costCents <= 0) {
    return;
  }

  const centsBalance = await getBalance(
    createNetworkScope("mainnet"),
    userId,
    organizationId,
    tx,
    options,
  );

  if (centsBalance < costCents) {
    throw badRequest("Insufficient balance");
  }
}

/** The Project a Job charges with: the explicit one, else the Job's own. */
function resolveCreditProjectId(input: {
  projectId?: string | null;
  creditProjectId?: string | null;
}): string | null {
  return input.creditProjectId === undefined
    ? (input.projectId ?? null)
    : input.creditProjectId;
}

/** The Job's Creator (ADR 0057). */
function creatorConnect(creator: WorkCreator) {
  const fields = creatorFields(creator);
  return {
    ...(fields.creatorUserId && {
      creatorUser: { connect: { id: fields.creatorUserId } },
    }),
    ...(fields.creatorCoworkerId && {
      creatorCoworker: { connect: { id: fields.creatorCoworkerId } },
    }),
    ...(fields.creatorSokoBotId && {
      creatorSokoBot: { connect: { id: fields.creatorSokoBotId } },
    }),
  };
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
    ownerId: string | null;
    creator: WorkCreator;
    organizationId: string | null;
    workspaceId: string;
    inputData: InputSchemaType;
    inputSchema: InputSchemaSchemaType;
    name: string | null;
    projectId?: string | null;
    /** See `CreateAgentJobInput.creditProjectId`. */
    creditProjectId?: string | null;
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
): Promise<JobWithListSummaryRelations> {
  const inputSchemaSnapshot = JSON.stringify(input.inputSchema);
  // The debit first, then the Job that links it, in the same transaction.
  const spent = await spend({
    // shortcut: the hire charges Mainnet, as it did; ticket 25 passes the Job's Network.
    scope: createNetworkScope("mainnet"),
    tx,
    kind: "job_hire",
    payer: {
      // An empty id is no payer: the debit was connected only to a present
      // owner and Organization, so an empty one is null, for the read and
      // the write.
      userId: input.ownerId || null,
      organizationId: input.organizationId || null,
      projectId: resolveCreditProjectId(input),
    },
    quotedCents: cost.cents,
    mode: "in_full",
  });
  // The balance read just before covered the price, so only a bucket read
  // that counts otherwise falls short: it throws as that read always did.
  if (spent.shortfall) {
    throw new InsufficientBalanceError(cost.cents, spent.availableCents);
  }
  // The debit's time is the Job's, its first event's and its input's: one
  // nested create gave all four one instant, and the history reads the Job's
  // spend at it.
  const { transactionId, createdAt } = spent;
  const at = { createdAt, updatedAt: createdAt };

  const job = await tx.job.create({
    data: {
      ...at,
      agentJobId: agentJobResponse.id,
      jobType: JobType.PAID,
      agent: { connect: { id: input.agentId } },
      ...(input.ownerId && { owner: { connect: { id: input.ownerId } } }),
      ...creatorConnect(input.creator),
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
          ...at,
          status: AgentJobStatus.INITIATED,
          result: null,
          inputSchema: inputSchemaSnapshot,
          input: {
            create: {
              ...at,
              input: JSON.stringify(input.inputData),
              inputHash: agentJobResponse.input_hash,
            },
          },
        },
      },
      transaction: { connect: { id: transactionId } },
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
      ...(agentJobResponse.paymentSourceType !== undefined && {
        paymentSourceType: agentJobResponse.paymentSourceType,
      }),
      ...(agentJobResponse.supportedPaymentSourceIndex !== undefined && {
        supportedPaymentSourceIndex:
          agentJobResponse.supportedPaymentSourceIndex,
      }),
      purchaseAmounts,
      purchaseAmountMatchRequired,
      sellerVkey: agentJobResponse.sellerVKey,
      identifierFromPurchaser,
    },
    include: {
      ...jobListSummaryInclude,
    },
  });
  await tx.agent.update({
    where: { id: input.agentId },
    data: { jobCount: { increment: 1 } },
  });
  return job;
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
    ownerId: string | null;
    creator: WorkCreator;
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
): Promise<JobWithListSummaryRelations> {
  const inputSchemaSnapshot = JSON.stringify(input.inputSchema);
  const job = await tx.job.create({
    data: {
      agentJobId: agentJobResponse.id,
      jobType: JobType.FREE,
      agent: { connect: { id: input.agentId } },
      ...(input.ownerId && { owner: { connect: { id: input.ownerId } } }),
      ...creatorConnect(input.creator),
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
      ...jobListSummaryInclude,
    },
  });
  await tx.agent.update({
    where: { id: input.agentId },
    data: { jobCount: { increment: 1 } },
  });
  return job;
}

interface CreateAgentJobInput {
  owner: JobOwnerContext;
  /** Who hires: the owner themselves, or a Coworker or Soko Bot for them. */
  creator: WorkCreator;
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
  /**
   * The Project whose credits pay for the Job, ahead of the pool (ADR 0067).
   * A Soko Bot's hire passes its bot's Project, even for a Job with none.
   * Undefined charges with the Job's own `projectId`; null sees only the pool.
   */
  creditProjectId?: string | null;
  /**
   * Runs after all local pricing, Agent, project, and buyer-cap validation but
   * immediately before the seller-side start request. Callers use this
   * boundary to durably fence retries that could otherwise start paid work
   * twice after an ambiguous network response.
   */
  beforeSellerStart?: () => Promise<void>;
  /** Reports classified seller-start failure after the retry fence exists. */
  afterSellerStartFailure?: (failure: AgentJobStartFailure) => Promise<void>;
  /**
   * Runs after the Job and initial event are created, inside the same local
   * transaction and before commit. Callers can atomically attach exact local
   * correlation without changing normal Job creation behavior.
   */
  afterLocalJobCreate?: (
    job: JobWithListSummaryRelations,
    tx: Prisma.TransactionClient,
  ) => Promise<void>;
}

export interface JobOwnerContext {
  ownerId: string | null;
  organizationId: string | null;
  workspaceId: string;
}

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
  options: { page?: boolean; sentryExtra?: Record<string, unknown> } = {},
): void {
  const message = `Seller-side job orphaned after start_job: ${reason}`;
  recordCoreError(
    { operation: "agent_job_start" },
    {
      message: "A seller started a job that Sokosumi will not track",
      why: `The ${reason}`,
      fix: "MIP-003 has no cancel, so the seller's job runs on. Check the agent's registry data or seller; the fields name what it returned.",
    },
    context,
  );
  if (options.page !== false) {
    Sentry.captureException(new Error(message), {
      extra: { ...context, ...options.sentryExtra },
    });
  }
}

/** The seller's failure text can echo the job's input. */
const START_JOB_FAILURE_WHY: Record<AgentJobStartFailure["kind"], string> = {
  unreachable: "The seller could not be reached or refused the job",
  ambiguous:
    "The seller's start_job call timed out or failed after it was sent",
  "invalid-response": "The seller answered start_job off the MIP-003 contract",
};

/**
 * A `start_job` call that never produced a usable response.
 *
 * Only `invalid-response` pages. There the seller answered 2xx — it accepted
 * the job and started work — and the body still did not parse, so seller-side
 * work definitely exists that we cannot record, and MIP-003 has no cancel.
 *
 * `ambiguous` (timeout, 5xx, 3xx after dispatch) is logged, not paged. It is
 * indistinguishable from ordinary seller flakiness, it is the single most
 * common way a hire fails, and no money has moved: credits are charged after
 * start_job returns, so the user is simply told the hire failed. `main` paged
 * on none of this, and routing every flaky seller into on-call would bury the
 * definite case above in noise.
 */
function reportStrandedStartJobFailure(
  failure: AgentJobStartFailure,
  context: Record<string, unknown>,
): void {
  if (failure.kind !== "invalid-response") {
    recordCoreWarning(
      { operation: "agent_job_start" },
      {
        message: "A seller's start_job call failed",
        why: START_JOB_FAILURE_WHY[failure.kind],
        fix: "Nothing: no credits were charged and the user is told the hire failed. If one agent keeps failing, check its seller.",
      },
      { ...context, startJob: { kind: failure.kind } },
    );
    return;
  }
  reportOrphanedSellerJob(
    "seller accepted start_job but returned a response that does not match the MIP-003 contract",
    { ...context, startJob: { kind: failure.kind } },
    { sentryExtra: { failure: failure.message } },
  );
}

export async function createAgentJobForUser(
  input: CreateAgentJobInput,
): Promise<JobWithListSummaryRelations> {
  const { owner, agentInput, taskContext } = input;
  await requireOwnerSeat(owner.ownerId, owner.organizationId);
  const maxCents =
    agentInput.maxAcceptedCents ??
    (agentInput.maxCredits
      ? convertCreditsToCents(agentInput.maxCredits)
      : null);

  // shortcut: the hire reads Mainnet's catalog, as it did; ticket 25 passes the Job's Network.
  const hire = await requireAgentForHire(
    createNetworkScope("mainnet"),
    agentInput.agentId,
    maxCents,
  );
  const { agent, cardanoV2ReadySources, preparedV2Sources } = hire;
  let cost = hire.cost;
  const isV2Agent = isV2HireAgent(agent);

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
    creator: input.creator,
    organizationId: owner.organizationId,
    workspaceId: owner.workspaceId,
    inputData: agentInput.inputData,
    inputSchema: agentInput.inputSchema,
    projectId: agentInput.projectId,
    creditProjectId: input.creditProjectId,
    taskId: taskContext?.taskId,
  };
  const creditProjectId = resolveCreditProjectId(jobInput);

  // Complete fallible local preflight before seller dispatch. Final balance
  // validation still runs in Job creation transaction to close spend races.
  await resolveJobName();
  if (cost.cents > 0) {
    await serializableTransaction(
      async (tx) =>
        validateCreditBalance(
          owner.ownerId,
          owner.organizationId,
          cost.cents,
          tx,
          { projectId: creditProjectId },
        ),
      "Balance preflight conflicted with a concurrent credit update. Please retry.",
    );
  }

  let paidJobResult: StartPaidJobResponseSchemaType | null = null;
  let freeJobResult: StartFreeJobResponseSchemaType | null = null;
  let identifierFromPurchaser: string | null = null;
  let expectedPurchaseAmounts: { unit: string; amount: string }[] | null = null;
  let purchaseRequestAmounts: { unit: string; amount: string }[] | null = null;

  switch (agent.pricing.pricingType) {
    case PricingType.FREE: {
      await input.beforeSellerStart?.();
      const startFreeJobResult = await createAgentClient().startFreeAgentJob(
        masumiAgent,
        agentInput.inputData,
      );

      if (startFreeJobResult.isErr()) {
        await input.afterSellerStartFailure?.(startFreeJobResult.error);
        reportStrandedStartJobFailure(startFreeJobResult.error, {
          agentId: agent.id,
          pricingType: PricingType.FREE,
        });
        throw unprocessableEntity(
          `Free agent job start failed: ${startFreeJobResult.error.message}`,
        );
      }

      freeJobResult = startFreeJobResult.value;
      break;
    }
    case PricingType.FIXED: {
      identifierFromPurchaser = uuidv4().replace(/-/g, "").substring(0, 20);

      await input.beforeSellerStart?.();
      const startPaidJobResult = await createAgentClient().startPaidAgentJob(
        masumiAgent,
        identifierFromPurchaser,
        agentInput.inputData,
      );

      if (startPaidJobResult.isErr()) {
        await input.afterSellerStartFailure?.(startPaidJobResult.error);
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
        reportOrphanedSellerJob(
          "seller returned a different purchaser identifier",
          {
            agentId: agent.id,
            agentJobId: response.id,
            expectedIdentifierFromPurchaser: identifierFromPurchaser,
            receivedIdentifierFromPurchaser: response.identifierFromPurchaser,
          },
        );
        throw unprocessableEntity(
          "Paid agent job returned a different purchaser identifier",
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
          reportOrphanedSellerJob(
            "seller returned an unexpected payment source",
            {
              agentId: agent.id,
              agentJobId: response.id,
              receivedPaymentSourceIndex: response.supportedPaymentSourceIndex,
              registeredPaymentSourceIndexes: agent.paymentSources.map(
                (source) => source.sourceIndex,
              ),
            },
          );
          throw unprocessableEntity(
            "Paid V2 agent job returned an unexpected payment source",
          );
        }
        // Same readiness snapshot as preflight: this is not a mid-request
        // flip. Seller can still echo a stored source that was not ready
        // (and therefore not prepared) at hire time.
        const isSelectedSourcePurchaseReady = isCardanoV2SourceReady(
          agent.blockchainIdentifier,
          selectedSource.address,
          cardanoV2ReadySources,
        );
        if (!isSelectedSourcePurchaseReady) {
          reportOrphanedSellerJob(
            "seller selected a payment source that is not purchase-ready",
            {
              agentId: agent.id,
              agentJobId: response.id,
              selectedPaymentSourceIndex: selectedSource.sourceIndex,
              selectedPaymentSourceAddress: selectedSource.address,
            },
          );
          throw unprocessableEntity(
            "Paid V2 agent job selected a payment source that is not purchase-ready",
          );
        }
        if (
          response.paymentSourceType !== undefined &&
          response.paymentSourceType !== "Web3CardanoV2"
        ) {
          reportOrphanedSellerJob(
            "seller returned an invalid payment source type",
            {
              agentId: agent.id,
              agentJobId: response.id,
              receivedPaymentSourceType: response.paymentSourceType,
            },
          );
          throw unprocessableEntity(
            "Paid V2 agent job returned an invalid payment source type",
          );
        }
        const preparedSource = preparedV2Sources.get(
          selectedSource.sourceIndex,
        );
        if (!preparedSource) {
          reportOrphanedSellerJob(
            "seller selected an ineligible payment source",
            {
              agentId: agent.id,
              agentJobId: response.id,
              selectedPaymentSourceIndex: selectedSource.sourceIndex,
              preparedPaymentSourceIndexes: Array.from(
                preparedV2Sources.keys(),
              ),
            },
          );
          throw unprocessableEntity(
            "Paid V2 agent job selected an ineligible payment source",
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
          recordCoreWarning(
            { operation: "agent_job_start" },
            {
              message: "A legacy agent's seller returned V2 payment fields",
              why: "The seller of a V1 agent echoed V2 payment fields, as an upgraded seller SDK does",
              fix: "Nothing: the hire continues on the V1 rail. The agent's registry entry should move to V2.",
            },
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
        // Empty amounts are truthy as `[]` and would otherwise record an
        // exact-match requirement against no units / send `[]` to the node.
        if (fixedPricingAmounts.length === 0) {
          throw unprocessableEntity("Paid agent has no fixed pricing amounts");
        }
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

      break;
    }
    case PricingType.UNKNOWN:
    default:
      throw unprocessableEntity("Agent pricing type not supported");
  }

  const job = await serializableTransaction(async (tx) => {
    await requireOwnerSeat(owner.ownerId, owner.organizationId, tx);
    await validateCreditBalance(
      owner.ownerId,
      owner.organizationId,
      cost.cents,
      tx,
      { projectId: creditProjectId },
    );

    let createdJob: JobWithListSummaryRelations;
    if (agent.pricing.pricingType === PricingType.FREE) {
      if (!freeJobResult) {
        throw unprocessableEntity("Free agent job start failed");
      }

      createdJob = await createFreeJob(
        { ...jobInput, name: jobName },
        freeJobResult,
        tx,
      );
    } else {
      if (
        !paidJobResult ||
        !identifierFromPurchaser ||
        !expectedPurchaseAmounts
      ) {
        throw unprocessableEntity("Paid agent job start failed");
      }

      createdJob = await createPaidJob(
        { ...jobInput, name: jobName },
        cost,
        paidJobResult,
        identifierFromPurchaser,
        expectedPurchaseAmounts,
        purchaseRequestAmounts !== null,
        tx,
      );
    }
    await input.afterLocalJobCreate?.(createdJob, tx);
    return createdJob;
  }, "Job creation conflicted with a concurrent request. Please retry.");

  // Right after the commit, because the check publishes over realtime and a
  // job that rolled back must not warn about the credits it did not take, and
  // before purchase registration, whose failure must not skip the check for a
  // charge that landed.
  if (cost.cents > 0n) {
    await notifyLowBalanceAfterCharge(
      {
        userId: owner.ownerId,
        organizationId: owner.organizationId,
      },
      createNetworkScope("mainnet"),
    );
  }

  if (
    agent.pricing.pricingType === PricingType.FIXED &&
    paidJobResult &&
    identifierFromPurchaser
  ) {
    await registerJobPurchase({
      jobId: job.id,
      agentId: agentInput.agentId,
      agentBlockchainIdentifier: agent.blockchainIdentifier,
      startJobResponse: paidJobResult,
      inputData: agentInput.inputData,
      identifierFromPurchaser,
      // Spell ADA the way the payment node's contract does. Internally the
      // canonical unit is `lovelace`; POST /purchase documents an empty string
      // for ADA, so a literal comparison against `lovelace` would reject every
      // ADA-priced drift guard.
      amounts: purchaseRequestAmounts
        ? toMasumiPaymentNodeAmounts(purchaseRequestAmounts)
        : undefined,
    });
  }

  return job;
}

// Delegated coworkers only see jobs on Tasks assigned to them or on
// private Tasks assigned to a same-vendor sibling.
export function jobListActorFilter(authContext: AuthenticationContext) {
  if (isCoworkerAuthContext(authContext)) {
    return {
      coworkerId: authContext.coworkerId,
      coworkerVendorId: authContext.vendorId,
    };
  }
  if (isSokoBotAuthContext(authContext)) {
    return { sokoBotId: authContext.sokoBotId };
  }
  return {};
}

const jobListNetworkInclude = {
  events: jobListSummaryInclude.events,
  transaction: jobListSummaryInclude.transaction,
  purchase: jobListSummaryInclude.purchase,
} satisfies Prisma.JobInclude;

export async function loadJobSharedRelations<T extends Job>(
  db: SharedDb,
  jobs: T[],
) {
  if (jobs.length === 0) return [];

  const ids = (values: (string | null)[]) => [
    ...new Set(values.filter((id) => id !== null)),
  ];
  const [workspaces, organizations, users, coworkers, bots] = await Promise.all(
    [
      db.workspace.findMany({
        where: { id: { in: ids(jobs.map((job) => job.workspaceId)) } },
        ...jobListSummaryInclude.workspace,
      }),
      db.organization.findMany({
        where: { id: { in: ids(jobs.map((job) => job.organizationId)) } },
        ...jobListSummaryInclude.organization,
      }),
      db.user.findMany({
        where: {
          id: {
            in: ids(jobs.flatMap((job) => [job.ownerId, job.creatorUserId])),
          },
        },
        ...jobListSummaryInclude.owner,
      }),
      db.coworker.findMany({
        where: { id: { in: ids(jobs.map((job) => job.creatorCoworkerId)) } },
        ...jobListSummaryInclude.creatorCoworker,
      }),
      db.sokoBot.findMany({
        where: { id: { in: ids(jobs.map((job) => job.creatorSokoBotId)) } },
        ...jobListSummaryInclude.creatorSokoBot,
      }),
    ],
  );
  const byId = <Row extends { id: string }>(rows: Row[]) =>
    new Map(rows.map((row) => [row.id, row]));
  const workspaceById = byId(workspaces);
  const organizationById = byId(organizations);
  const userById = byId(users);
  const coworkerById = byId(coworkers);
  const botById = byId(bots);
  return jobs.map((job) => {
    const workspace = workspaceById.get(job.workspaceId);
    if (!workspace) throw internalServerError(`Job ${job.id} has no workspace`);
    return {
      ...job,
      workspace,
      organization:
        job.organizationId === null
          ? null
          : (organizationById.get(job.organizationId) ?? null),
      owner: job.ownerId === null ? null : (userById.get(job.ownerId) ?? null),
      creatorUser:
        job.creatorUserId === null
          ? null
          : (userById.get(job.creatorUserId) ?? null),
      creatorCoworker:
        job.creatorCoworkerId === null
          ? null
          : (coworkerById.get(job.creatorCoworkerId) ?? null),
      creatorSokoBot:
        job.creatorSokoBotId === null
          ? null
          : (botById.get(job.creatorSokoBotId) ?? null),
    };
  });
}

export async function readTaskJobs(
  scope: NetworkScope,
  taskId: string,
): Promise<JobWithListSummaryRelations[]> {
  const { networkDb, sharedDb } = scope;
  const args = { where: { taskId }, orderBy: { createdAt: "asc" } } as const;
  if (networkUsesSharedSchema()) {
    return await networkDb.job.findMany({
      ...args,
      include: jobListSummaryInclude,
    });
  }
  const jobs = await networkDb.job.findMany({
    ...args,
    include: jobListNetworkInclude,
  });
  return await loadJobSharedRelations(sharedDb, jobs);
}

interface JobListOptions {
  agentId?: string;
  projectId?: string | null;
  status?: AgentJobStatus;
  scope?: "workspace" | "owned";
  coworkerId?: string;
  coworkerVendorId?: string;
  sokoBotId?: string;
  cursor?: string;
  take: number;
  skip?: number;
}

async function readSplitJobPage(
  networkScope: NetworkScope,
  context: JobContext,
  options: JobListOptions,
) {
  const { userContext, workspaceContext } = context;
  const {
    agentId,
    projectId,
    status,
    coworkerId,
    coworkerVendorId,
    sokoBotId,
    cursor,
    take,
    skip,
  } = options;
  const { networkDb, sharedDb, networkTable } = networkScope;
  const { sql, empty } = PrismaRaw;
  const jobTable = networkTable("Job");
  const coworkerTask = coworkerId
    ? buildCoworkerJobParentTaskSql(coworkerId, coworkerVendorId)
    : undefined;
  const projectFilter =
    projectId === undefined
      ? empty
      : projectId === null
        ? sql`AND j."projectId" IS NULL`
        : sql`AND j."projectId" = ${projectId}::uuid`;
  const matching = sql`
    FROM ${jobTable} j
    LEFT JOIN ${sharedTable("task")} t ON t.id = j."taskId"
    ${coworkerTask?.join ?? empty}
    WHERE j."workspaceId" = ${workspaceContext.workspaceId}::uuid
    ${(options.scope ?? "owned") === "owned" ? sql`AND j."ownerId" = ${userContext.userId}` : empty}
    ${coworkerTask?.predicate ?? buildHumanJobParentVisibilitySql(userContext.userId)}
    ${agentId ? sql`AND j."agentId" = ${agentId}` : empty}
    ${projectFilter}
    ${sokoBotId ? sql`AND t."assigneeSokoBotId" = ${sokoBotId}::uuid` : empty}
    ${
      // Match Prisma's status binding so PostgreSQL can choose the same event index for counts.
      status
        ? sql`AND EXISTS (
      SELECT 1 FROM ${networkTable("jobEvent")} e
      WHERE e."jobId" = j.id
        AND e.status = ${status}::text::${netType(networkScope.network, "AgentJobStatus")}
    )`
        : empty
    }
  `;
  const page = sql`
    SELECT j.id ${matching}
    ${
      cursor
        ? sql`AND (j."createdAt", j.id) <= (
      SELECT c."createdAt", c.id FROM ${jobTable} c WHERE c.id = ${cursor}
    )`
        : empty
    }
    ORDER BY j."createdAt" DESC, j.id DESC
    LIMIT ${take + 1} OFFSET ${skip ?? 0}
  `;
  const [selected, [total]] = await Promise.all([
    networkDb.$queryRaw<{ id: string }[]>(page),
    networkDb.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count ${matching}`,
  ]);
  const ids = selected.slice(0, take).map(({ id }) => id);
  const jobs =
    ids.length === 0
      ? []
      : await networkDb.job.findMany({
          where: { id: { in: ids } },
          include: jobListNetworkInclude,
        });
  const hydrated = await loadJobSharedRelations(sharedDb, jobs);
  const byId = new Map(hydrated.map((job) => [job.id, job]));
  return {
    jobs: ids.flatMap((id) => {
      const job = byId.get(id);
      return job ? [flattenJob(job)] : [];
    }),
    count: Number(total.count),
    hasMore: selected.length === take + 1,
  };
}

/**
 * Retrieves paginated jobs for the authenticated user, optionally filtered by agent ID.
 * Includes all job relations (events, credit transactions, purchases) and returns both jobs and count.
 *
 * @param networkScope - The request's Network
 * @param context - The authenticated user and workspace context
 * @param options - Query options
 * @param options.agentId - Optional agent ID to filter jobs by
 * @param options.cursor - Optional cursor for pagination
 * @param options.take - Number of items to take
 * @param options.skip - Number of items to skip (used for cursor pagination)
 * @returns Object containing flattened jobs array and total count
 *
 * @example
 * // Get paginated jobs for the user
 * const { jobs, count } = await getUserJobs(networkScope, {
 *   userContext,
 *   workspaceContext,
 * }, {
 *   take: 20,
 * });
 *
 * @example
 * // Get paginated jobs for a specific agent with cursor
 * const { jobs, count } = await getUserJobs(networkScope, {
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
  networkScope: NetworkScope,
  context: JobContext,
  options: JobListOptions,
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
    coworkerVendorId,
    sokoBotId,
    cursor,
    take,
    skip,
  } = options;
  const { userContext, workspaceContext } = context;

  // A delegated coworker may only list jobs whose task is assigned to it.
  if (coworkerId) {
    await requireCoworkerCapability(coworkerId, "tasks", networkScope.sharedDb);
  }

  if (!networkUsesSharedSchema()) {
    return await readSplitJobPage(networkScope, context, options);
  }
  const { networkDb } = networkScope;

  const humanParentTaskVisibility = coworkerId
    ? []
    : [buildHumanJobParentVisibilityWhere(userContext.userId)];

  const where: Prisma.JobWhereInput = {
    AND: [
      {
        workspaceId: workspaceContext.workspaceId,
        ...(scope === "owned" ? { ownerId: userContext.userId } : {}),
      },
      ...humanParentTaskVisibility,
      ...(agentId ? [{ agentId }] : []),
      ...(projectId !== undefined ? [{ projectId }] : []),
      ...(status ? [{ events: { some: { status: { equals: status } } } }] : []),
      // `task` is an optional to-one relation, so this filter requires the job
      // to HAVE a task assigned to this coworker — null-task jobs are excluded.
      ...(coworkerId
        ? coworkerVendorId
          ? [
              buildCoworkerJobParentTaskWhere({
                coworkerId,
                vendorId: coworkerVendorId,
              }),
            ]
          : [{ task: { assigneeId: coworkerId } }]
        : []),
      ...(sokoBotId ? [{ task: { assigneeSokoBotId: sokoBotId } }] : []),
    ],
  };

  const takePlusOne = take + 1;
  // List and total are independent reads, as on the split layout.
  const [jobs, count] = await Promise.all([
    networkDb.job.findMany({
      where,
      take: takePlusOne,
      ...(skip !== undefined && { skip }),
      ...(cursor && { cursor: { id: cursor } }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        ...jobListSummaryInclude,
      },
    }),
    networkDb.job.count({ where }),
  ]);
  return {
    jobs: jobs.slice(0, take).map(flattenJob),
    count,
    hasMore: jobs.length === takePlusOne,
  };
}
