import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import { getSession, getSessionOrThrow } from "@/lib/auth/utils";
import {
  AgentWithCreditPrice,
  AgentWithFixedPricing,
  AgentWithJobs,
  AgentWithOrganizations,
  AgentWithRelations,
  convertCreditsToCents,
  CreditsPrice,
} from "@/lib/db";
import {
  agentListRepository,
  agentRepository,
  creditCostRepository,
  mapAgentWithIsNew,
  memberRepository,
  prisma,
} from "@/lib/db/repositories";
import { pricingAmountsSchema, PricingAmountsSchemaType } from "@/lib/schemas";
import {
  AgentListType,
  AgentStatus,
  CreditCost,
  Prisma,
} from "@/prisma/generated/client";

export const agentService = {
  async getFavoriteAgents(): Promise<AgentWithRelations[]> {
    return await getAgentsByListType(AgentListType.FAVORITE);
  },

  /**
   * Retrieves all online agents available to the current user with valid pricing.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns Array of available agents with valid pricing.
   */
  async getAvailableAgents(): Promise<AgentWithRelations[]> {
    return await prisma.$transaction(async (tx) => {
      const { userOrganizationIds, creditCosts } =
        await getAgentAccessContext(tx);
      const onlineAgents =
        await agentRepository.getShownAgentsWithRelationsByStatus(
          AgentStatus.ONLINE,
          tx,
        );
      return onlineAgents.filter((agent) =>
        isAgentAvailable(agent, userOrganizationIds, creditCosts),
      );
    });
  },

  /**
   * Retrieves an available agent by ID, validating access control for the current user.
   *
   * - Returns null if the agent doesn't exist, is not shown, or the user lacks access.
   * - Returns the agent if accessible.
   *
   * @param agentId - Unique agent identifier.
   * @returns The agent with all relations if accessible, null otherwise.
   */
  async getAvailableAgentById(
    agentId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentWithRelations | null> {
    const agent = await agentRepository.getShownAgentWithRelationById(
      agentId,
      AgentStatus.ONLINE,
      tx,
    );
    if (!agent) return null;
    const { userOrganizationIds, creditCosts } =
      await getAgentAccessContext(tx);
    if (!isAgentAvailable(agent, userOrganizationIds, creditCosts)) return null;
    return agent;
  },

  /**
   * Retrieves all online agents available to the user, each with its calculated credit price.
   *
   * - Excludes agents for which credit price calculation fails.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns Array of agents with their calculated credit prices.
   */
  async getAvailableAgentsWithCreditsPrice(): Promise<AgentWithCreditPrice[]> {
    const agents = await this.getAvailableAgents();
    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        const creditsPrice = await this.getAgentCreditsPrice(agent);
        return { agent, creditsPrice };
      }),
    );
    return results
      .filter(
        (result): result is PromiseFulfilledResult<AgentWithCreditPrice> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
  },

  /**
   * Retrieves all agents hired by the current user, ordered by the most recent job activity (newest first).
   *
   * - Requires an active user session.
   * - Agents without jobs are placed at the end of the list.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns Array of hired agents with their jobs, sorted by recent activity.
   * @throws If no active session is found.
   */
  async getHiredAgents(): Promise<AgentWithJobs[]> {
    const session = await getSessionOrThrow();
    const userId = session.user.id;
    const activeOrganizationId = session.session.activeOrganizationId;
    const hiredAgentsWithJobs =
      await agentRepository.getHiredAgentsWithJobsByUserIdAndOrganization(
        userId,
        activeOrganizationId,
      );
    return hiredAgentsWithJobs.sort((a, b) => {
      const aLatestJob = a.jobs[0];
      const bLatestJob = b.jobs[0];
      if (!aLatestJob) return 1;
      if (!bLatestJob) return -1;
      return bLatestJob.startedAt.getTime() - aLatestJob.startedAt.getTime();
    });
  },

  /**
   * Calculates the total credit price (in cents) for a given agent's fixed pricing.
   *
   * - Extracts the pricing amounts from the agent's fixed pricing configuration.
   * - Converts the amounts to the expected format.
   * - Delegates the calculation to `getCreditsPrice`.
   * - Returns zero if the agent has no pricing amounts.
   *
   * @param agent - The agent object containing fixed pricing information.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns An object containing the total price in cents and the included fee, both as bigint.
   */
  async getAgentCreditsPrice(
    agent: AgentWithFixedPricing,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<CreditsPrice> {
    const amounts = agent.pricing?.fixedPricing?.amounts?.map((amount) => ({
      unit: amount.unit,
      amount: Number(amount.amount),
    }));
    if (!amounts) {
      return { cents: BigInt(0), includedFee: BigInt(0) };
    }
    return await getCreditsPrice(amounts, tx);
  },
};

/**
 * Calculates the total credit price (in cents) for a set of pricing amounts, including a configurable fee.
 *
 * - Fetches the credit cost per unit from the repository for each amount.
 * - Applies a fee percentage (from public config) to the subtotal.
 * - Ensures the total fee is at least the minimum fee (from secrets).
 * - Rounds up cents and fee to the nearest integer for each unit.
 *
 * @param amounts - Array of pricing amounts (unit and amount) to price.
 * @param tx - Optional Prisma transaction client for DB access (defaults to global prisma).
 * @returns An object containing the total price in cents and the included fee in cents.
 * @throws If the fee percentage is negative or a credit cost for a unit is not found.
 */
async function getCreditsPrice(
  amounts: PricingAmountsSchemaType,
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditsPrice> {
  const feePercentagePoints = getEnvPublicConfig().NEXT_PUBLIC_FEE_PERCENTAGE;
  if (feePercentagePoints < 0) {
    throw new Error("Added fee percentage must be equal to or greater than 0");
  }
  const feeMultiplier = feePercentagePoints / 100;
  const amountsParsed = pricingAmountsSchema.parse(amounts);

  let totalCents = BigInt(0);
  let totalFee = BigInt(0);
  const minFeeCents = convertCreditsToCents(getEnvSecrets().MIN_FEE_CREDITS);
  for (const amount of amountsParsed) {
    const creditCost = await creditCostRepository.getCreditCostByUnit(
      amount.unit,
      tx,
    );
    if (!creditCost) {
      throw new Error(`Credit cost not found for unit ${amount.unit}`);
    }
    const cents = amount.amount * Number(creditCost.centsPerUnit);
    const fee = cents * feeMultiplier;

    // round up to the nearest integer
    totalCents += BigInt(Math.ceil(cents));
    totalFee += BigInt(Math.ceil(fee));
  }
  if (totalFee < minFeeCents) {
    totalFee = minFeeCents;
  }
  return { cents: totalCents + totalFee, includedFee: totalFee };
}

/**
 * Utility: Checks if a user can access an agent based on organization membership and agent visibility.
 *
 * @param agent - Agent with organization data.
 * @param userOrganizationIds - Organization IDs the user is a member of.
 * @returns True if the user can access the agent, false otherwise.
 */
function canUserAccessAgent(
  agent: AgentWithOrganizations,
  userOrganizationIds: string[],
): boolean {
  if (!agent.isShown) return false;
  if (agent.organizations.length === 0) return true;
  if (userOrganizationIds.length === 0) return false;
  return agent.organizations.some((agentOrg) =>
    userOrganizationIds.includes(agentOrg.id),
  );
}

/**
 * Utility: Checks if an agent's fixed pricing units are all valid according to the provided credit costs.
 *
 * @param agent - Agent with fixed pricing information.
 * @param creditCosts - Array of valid credit cost objects.
 * @returns True if all pricing units are valid or if there are no amounts, false otherwise.
 */
function hasValidPricing(
  agent: AgentWithFixedPricing,
  creditCosts: CreditCost[],
): boolean {
  const units = creditCosts.map(({ unit }) => unit);
  const amounts = agent.pricing.fixedPricing?.amounts?.map((amount) => ({
    unit: amount.unit,
    amount: Number(amount.amount),
  }));
  if (!amounts) {
    return true;
  }
  return amounts.every(({ unit }) => units.includes(unit));
}

/**
 * Utility: Determines if an agent is available to the user based on access permissions and pricing validity.
 *
 * @param agent - Agent with relations including organization and pricing data.
 * @param organizationIds - Organization IDs the user is a member of.
 * @param creditCosts - Valid credit cost objects for pricing validation.
 * @returns True if the agent is available to the user, false otherwise.
 */
function isAgentAvailable(
  agent: AgentWithRelations,
  organizationIds: string[],
  creditCosts: CreditCost[],
): boolean {
  return (
    canUserAccessAgent(agent, organizationIds) &&
    hasValidPricing(agent, creditCosts)
  );
}

/**
 * Retrieves the current session's organization IDs and all credit costs for agent access checks.
 *
 * @param tx - Optional Prisma transaction client for DB operations.
 * @returns Object with userOrganizationIds and creditCosts.
 */
async function getAgentAccessContext(
  tx: Prisma.TransactionClient = prisma,
): Promise<{
  userOrganizationIds: string[];
  creditCosts: CreditCost[];
}> {
  const session = await getSession();
  const creditCosts = await creditCostRepository.getCreditCosts(tx);
  const userOrganizationIds =
    session?.user.id && session.user.id !== ""
      ? await memberRepository.getMembersOrganizationIdsByUserId(
          session.user.id,
          tx,
        )
      : [];
  return { userOrganizationIds, creditCosts };
}

async function getAgentsByListType(
  type: AgentListType,
): Promise<AgentWithRelations[]> {
  const session = await getSessionOrThrow();
  return await prisma.$transaction(async (tx) => {
    const existingList = await agentListRepository.getAgentListByUserId(
      session.user.id,
      type,
      tx,
    );
    if (existingList) {
      const { userOrganizationIds, creditCosts } =
        await getAgentAccessContext(tx);
      return existingList.agents
        .map(mapAgentWithIsNew)
        .filter((agent) =>
          isAgentAvailable(agent, userOrganizationIds, creditCosts),
        );
    }
    const list = await agentListRepository.createAgentListForUserId(
      session.user.id,
      type,
      tx,
    );
    return list.agents.map(mapAgentWithIsNew);
  });
}
