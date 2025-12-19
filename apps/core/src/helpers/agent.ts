import { type CreditCost, PricingType, type Prisma } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import {
  convertCentsToCredits,
  convertCreditsToCents,
  feeFromCentsBasedOnPercentagePoints,
} from "@sokosumi/database/helpers";

import { CREDIT } from "@/config/constants";
import { getAuthorFromAgent } from "@/schemas/author.schema";
import type { AgentWithOrganizations, AgentWithPricing } from "@/types/agent";

/**
 * Retrieves the current session's organization IDs and all credit costs for agent access checks.
 *
 * @param tx - Optional Prisma transaction client for DB operations.
 * @returns Object with userOrganizationIds and creditCosts.
 */
export const getAgentAccessContext = async (
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<{
  userOrganizationIds: string[];
  activeOrganizationId: string | null;
  creditCosts: CreditCost[];
}> => {
  const creditCosts = await tx.creditCost.findMany();
  const userMemberships = await tx.member.findMany({
    where: { userId },
    select: { organizationId: true },
  });
  const userOrganizationIds = userMemberships.map((m) => m.organizationId);
  const activeOrganizationId = organizationId ?? null;
  return { userOrganizationIds, activeOrganizationId, creditCosts };
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
 * Transforms an agent with pricing into the response format.
 * @param agent - The agent with pricing.
 * @param creditCosts - The credit costs.
 * @param minFeeCents - The minimum fee cents.
 * @returns The transformed agent with credits, or null if credits calculation fails.
 */
export const transformAgentWithCredits = (
  agent: AgentWithPricing,
  creditCosts: CreditCost[],
) => {
  const minFeeCents = convertCreditsToCents(CREDIT.MIN_FEE_CREDITS);
  const credits = calculateAgentCredits(agent, creditCosts, minFeeCents);

  if (credits === null) {
    return null;
  }

  return {
    ...agent,
    name: agent.overrideName ?? agent.name,
    description: agent.overrideDescription ?? agent.description,
    author: getAuthorFromAgent(agent),
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
      const [totalCentsWithFee, _] = roundUpCentsWithFee(totalCents, totalFee);
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
): [cents: bigint, fee: bigint] => {
  const centsWithFee = cents + fee;
  const roundedCentsWithFee = convertCreditsToCents(
    Math.ceil(convertCentsToCredits(centsWithFee)),
  );
  const diff = roundedCentsWithFee - centsWithFee;
  return [roundedCentsWithFee, fee + diff];
};
