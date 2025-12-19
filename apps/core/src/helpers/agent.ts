import {
  type Agent,
  type CreditCost,
  PricingType,
  type Prisma,
} from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import {
  convertCentsToCredits,
  convertCreditsToCents,
  feeFromCentsBasedOnPercentagePoints,
} from "@sokosumi/database/helpers";

import { CREDIT } from "@/config/constants";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  getAgentLegalFromAgent,
  getAuthorFromAgent,
} from "@/schemas/agent.schema";
import type {
  AgentWithJobsCount,
  AgentWithOrganizations,
  AgentWithPricing,
} from "@/types/agent";

import { internalServerError } from "./error";
import { ipfsUrlResolver } from "./ipfs";

export const getAgentImage = (agent: Agent): string | null => {
  const image = agent.overrideImage ?? agent.image;
  if (!image) {
    return null;
  }
  return ipfsUrlResolver(image);
};

export const getAgentAuthorImage = (agent: Agent): string | null => {
  const image = agent.overrideAuthorImage ?? agent.authorImage;
  if (!image) {
    return null;
  }
  return ipfsUrlResolver(image);
};

/**
 * Retrieves the current session's organization IDs and all credit costs for agent access checks.
 *
 * @param tx - Optional Prisma transaction client for DB operations.
 * @returns Object with userOrganizationIds and creditCosts.
 */
export const getAgentAccessContext = async (
  authContext: AuthenticationContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<{
  userOrganizationIds: string[];
  creditCosts: CreditCost[];
}> => {
  const creditCosts = await tx.creditCost.findMany();
  if (!creditCosts || creditCosts.length === 0) {
    throw internalServerError("Failed to get credit information for agents");
  }
  const userMemberships = await tx.member.findMany({
    where: { userId: authContext.userId },
    select: { organizationId: true },
  });
  const userOrganizationIds = userMemberships.map((m) => m.organizationId);

  return {
    userOrganizationIds,
    creditCosts,
  };
};

/**
 * Utility: Checks if a user can access an agent based on organization membership and agent visibility.
 *
 * Blacklist behavior:
 * - When viewing in an organization context (activeOrganizationId present), that organization's
 *   blacklist is enforced, hiding agents they've explicitly blocked.
 * - When viewing in personal context (activeOrganizationId is null), no blacklists apply.
 * - Users in multiple organizations see different agents depending on their active context.
 *
 * @param agent - Agent with organization and blacklist data.
 * @param userOrganizationIds - Organization IDs the user is a member of.
 * @param activeOrganizationId - The currently active organization ID, or null for personal context.
 * @returns True if the user can access the agent, false otherwise.
 */
export const canUserAccessAgent = (
  agent: AgentWithOrganizations,
  userOrganizationIds: string[],
  activeOrganizationId: string | null,
): boolean => {
  // Blacklist: only enforce when organization scope is active
  // Personal context (null) is not affected by organizational blacklist decisions
  if (activeOrganizationId) {
    const isBlacklisted = agent.blacklistedOrganizations.some(
      ({ id }) => id === activeOrganizationId,
    );
    if (isBlacklisted) return false;
  }

  // Visibility: deny if agent is not shown
  if (!agent.isShown) return false;
  if (agent.organizations.length === 0) return true;
  if (userOrganizationIds.length === 0) return false;
  return agent.organizations.some((agentOrg) =>
    userOrganizationIds.includes(agentOrg.id),
  );
};

/**
 * Transforms an agent into the response format.
 * @param agent - The agent with pricing.
 * @param creditCosts - The credit costs.
 * @param executions - The number of executions.
 * @param averageExecutionTime - The average execution time in milliseconds.
 * @returns The transformed agent with credits, or null if credits calculation fails.
 */
export const transformAgent = (
  agent: AgentWithPricing & AgentWithOrganizations & AgentWithJobsCount,
  creditCosts: CreditCost[],
  averageExecutionTime?: number | null,
) => {
  const minFeeCents = convertCreditsToCents(CREDIT.MIN_FEE_CREDITS);
  const credits = calculateAgentCredits(agent, creditCosts, minFeeCents);

  if (credits === null) {
    return null;
  }

  return {
    ...agent,
    name: agent.overrideName ?? agent.name,
    image: getAgentImage(agent),
    description: agent.overrideDescription ?? agent.description,
    author: getAuthorFromAgent(agent),
    legal: getAgentLegalFromAgent(agent),
    executions: agent._count.jobs,
    averageExecutionTime,
    credits,
  };
};

/**
 * This function calculates the credits for an agent.
 * @param agent - The agent with pricing.
 * @param creditCosts - The credit costs.
 * @param minFeeCents - The minimum fee cents.
 * @returns The credits for the agent or null if the agent has invalid or unknown pricing.
 */
const calculateAgentCredits = (
  agent: AgentWithPricing,
  creditCosts: CreditCost[],
  minFeeCents: bigint,
): number | null => {
  switch (agent.pricing.pricingType) {
    case PricingType.FIXED: {
      if (
        !agent.pricing.fixedPricing ||
        agent.pricing.fixedPricing.amounts.length === 0
      ) {
        return null;
      }
      const pricing = agent.pricing.fixedPricing.amounts.map((amount) => ({
        unit: amount.unit,
        amount: amount.amount,
      }));

      let totalCents = BigInt(0);
      let totalFee = BigInt(0);
      for (const amount of pricing) {
        const creditCost = creditCosts.find(
          (creditCost) => creditCost.unit === amount.unit,
        );
        if (!creditCost) {
          return null;
        }
        const cents = amount.amount * creditCost.centsPerUnit;
        const fee = feeFromCentsBasedOnPercentagePoints(
          cents,
          CREDIT.FEE_PERCENTAGE_POINTS,
        );
        totalCents += cents;
        totalFee += fee;
      }

      if (totalFee < minFeeCents) {
        totalFee = minFeeCents;
      }
      const { cents: totalCentsWithFee } = roundUpCentsWithFee(
        totalCents,
        totalFee,
      );
      return convertCentsToCredits(totalCentsWithFee);
    }
    case PricingType.FREE: {
      return 0;
    }
    case PricingType.UNKNOWN: {
      return null;
    }
  }
};

/**
 * This function rounds up the total cents to show credits as integer.
 * Adds the difference to the total fee.
 * @param totalCents - The total cents to round up.
 * @param totalFee - The total fee.
 * @returns The rounded total cents with fee and the total fee which also includes difference.
 */
const roundUpCentsWithFee = (
  cents: bigint,
  fee: bigint,
): { cents: bigint; fee: bigint } => {
  const centsWithFee = cents + fee;
  const roundedCentsWithFee = convertCreditsToCents(
    Math.ceil(convertCentsToCredits(centsWithFee)),
  );
  const diff = roundedCentsWithFee - centsWithFee;
  return { cents: roundedCentsWithFee, fee: fee + diff };
};

export const getAverageExecutionTime = async (
  agentId: string,
  tx: Prisma.TransactionClient,
): Promise<number | null> => {
  const result = await tx.$queryRaw<[{ avg_duration_seconds: number | null }]>`
    SELECT 
      AVG(EXTRACT(EPOCH FROM (completed_event."createdAt" - j."createdAt"))) as avg_duration_seconds
    FROM "Job" j
    INNER JOIN LATERAL (
      SELECT js."createdAt"
      FROM "jobEvent" js
      WHERE js."jobId" = j.id
      AND js."status" = 'COMPLETED'::"AgentJobStatus"
      ORDER BY js."createdAt" DESC
      LIMIT 1
    ) completed_event ON true
    WHERE j."agentId" = ${agentId}
    AND j."jobType" != 'DEMO'
    AND j."createdAt" >= NOW() - INTERVAL '90 days'
  `;
  const averageDurationSeconds = result[0]?.avg_duration_seconds ?? null;
  return averageDurationSeconds ? Number(averageDurationSeconds) : null;
};

export const getAverageExecutionTimes = async (
  agentIds: string[],
  tx: Prisma.TransactionClient,
): Promise<Map<string, number | null>> => {
  if (agentIds.length === 0) return new Map();

  const averages = await tx.$queryRaw<
    Array<{
      agent_id: string;
      avg_duration_seconds: number | null;
    }>
  >`
    SELECT 
      j."agentId" as agent_id,
      AVG(EXTRACT(EPOCH FROM (completed_event."createdAt" - j."createdAt"))) as avg_duration_seconds
    FROM "Job" j
    INNER JOIN LATERAL (
      SELECT js."createdAt"
      FROM "jobEvent" js
      WHERE js."jobId" = j.id
      AND js."status" = 'COMPLETED'::"AgentJobStatus"
      ORDER BY js."createdAt" DESC
      LIMIT 1
    ) completed_event ON true
    WHERE j."agentId" = ANY(${agentIds}::text[])
    AND j."jobType" != 'DEMO'
    AND j."createdAt" >= NOW() - INTERVAL '90 days'
    GROUP BY j."agentId"
  `;

  // Create a map with all agentIds, defaulting to null for those without data
  const averagesMap = new Map<string, number | null>();

  // Initialize all agentIds with null
  for (const agentId of agentIds) {
    averagesMap.set(agentId, null);
  }

  // Set the actual values for agents that have data
  for (const average of averages) {
    averagesMap.set(
      average.agent_id,
      average.avg_duration_seconds
        ? Number(average.avg_duration_seconds)
        : null,
    );
  }

  return averagesMap;
};
