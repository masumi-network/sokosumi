import {
  AgentJobStatus,
  JobType,
  PricingType,
  type Prisma,
} from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import {
  convertCreditsToCents,
  feeFromCentsBasedOnPercentagePoints,
} from "@sokosumi/database/helpers";
import {
  creditTransactionRepository,
  jobShareRepository,
} from "@sokosumi/database/repositories";
import type { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import { v4 as uuidv4 } from "uuid";

import type { AuthenticationContext } from "@/middleware/auth";
import type { StartPaidJobResponseSchemaType } from "@/schemas/job.schema";
import { agentOrganizationsInclude, agentPricingInclude } from "@/types/agent";

import { badRequest, forbidden, notFound, unprocessableEntity } from "./error";

const CREDIT_MIN_FEE_CREDITS = 1;
const CREDIT_FEE_PERCENTAGE_POINTS = 500; // 5%

interface AgentWithCreditsPrice {
  id: string;
  name: string;
  blockchainIdentifier: string;
  apiBaseUrl: string;
  overrideApiBaseUrl: string | null;
  pricing: {
    pricingType: PricingType;
    fixedPricing: {
      amounts: Array<{
        unit: string;
        amount: bigint;
      }>;
    } | null;
  };
  creditsPrice: {
    cents: bigint;
    includedFee: bigint;
  };
}

/**
 * Validates agent exists, is available, and gets pricing
 */
export async function validateAgentAndPricing(
  agentId: string,
  authContext: AuthenticationContext,
  maxAcceptedCents: bigint,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithCreditsPrice> {
  const agent = await tx.agent.findUnique({
    where: { id: agentId },
    include: {
      ...agentPricingInclude,
      ...agentOrganizationsInclude,
    },
  });

  if (!agent) {
    throw notFound("Agent not found");
  }

  if (!agent.isShown) {
    throw forbidden("Agent is not available");
  }

  // Get credit costs for pricing calculation
  const creditCosts = await tx.creditCost.findMany();
  if (!creditCosts || creditCosts.length === 0) {
    throw unprocessableEntity("Failed to get credit information for agents");
  }

  // Calculate credits price
  let creditsPrice: { cents: bigint; includedFee: bigint };
  if (agent.pricing.pricingType === PricingType.FREE) {
    creditsPrice = { cents: BigInt(0), includedFee: BigInt(0) };
  } else if (agent.pricing.pricingType === PricingType.FIXED) {
    const fixedPricing = agent.pricing.fixedPricing;
    if (!fixedPricing || fixedPricing.amounts.length === 0) {
      throw unprocessableEntity("Agent has invalid or unknown pricing");
    }

    let totalCents = BigInt(0);
    let totalFee = BigInt(0);
    const minFeeCents = convertCreditsToCents(CREDIT_MIN_FEE_CREDITS);

    for (const amount of fixedPricing.amounts) {
      const creditCost = creditCosts.find((cost) => cost.unit === amount.unit);
      if (!creditCost) {
        throw unprocessableEntity(
          `Credit cost not found for unit ${amount.unit}`,
        );
      }
      const cents = amount.amount * creditCost.centsPerUnit;
      const fee = feeFromCentsBasedOnPercentagePoints(
        cents,
        CREDIT_FEE_PERCENTAGE_POINTS,
      );
      totalCents += cents;
      totalFee += fee;
    }

    if (totalFee < minFeeCents) {
      totalFee = minFeeCents;
    }

    // Round up to nearest integer credit (same logic as web app)
    const centsWithFee = totalCents + totalFee;
    const roundedCentsWithFee = convertCreditsToCents(
      Math.ceil(Number(centsWithFee) / Number(convertCreditsToCents(1))),
    );
    const diff = roundedCentsWithFee - centsWithFee;
    creditsPrice = {
      cents: roundedCentsWithFee,
      includedFee: totalFee + diff,
    };
  } else {
    throw unprocessableEntity("Agent has invalid or unknown pricing");
  }

  // Validate cost not too high
  if (creditsPrice.cents > maxAcceptedCents) {
    throw badRequest("Credit cost exceeds maximum accepted credits");
  }

  return {
    id: agent.id,
    name: agent.overrideName ?? agent.name,
    blockchainIdentifier: agent.blockchainIdentifier,
    apiBaseUrl: agent.apiBaseUrl,
    overrideApiBaseUrl: agent.overrideApiBaseUrl,
    pricing: agent.pricing,
    creditsPrice,
  };
}

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
  agent: AgentWithCreditsPrice,
  agentJobResponse: StartPaidJobResponseSchemaType,
  tx: Prisma.TransactionClient = prisma,
): Promise<string> {
  const identifierFromPurchaser = uuidv4().replace(/-/g, "").substring(0, 20);

  const job = await tx.job.create({
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
          amount: -agent.creditsPrice.cents,
          includedFee: agent.creditsPrice.includedFee,
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
      sellerVkey: agentJobResponse.sellerVKey, // Note: schema uses sellerVKey, but Prisma field is sellerVkey
      identifierFromPurchaser,
    },
  });

  return job.id;
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
): Promise<string> {
  const job = await tx.job.create({
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
  });

  return job.id;
}

/**
 * Updates job name
 */
export async function updateJobName(
  jobId: string,
  name: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.job.update({
    where: { id: jobId },
    data: { name: name.trim() || null },
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
