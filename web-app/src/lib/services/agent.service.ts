import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import { getAuthContext } from "@/lib/auth/utils";
import {
  AgentWithCreditsPrice,
  AgentWithFixedPricing,
  AgentWithJobs,
  AgentWithOrganizations,
  AgentWithRelations,
  convertCentsToCredits,
  convertCreditsToCents,
} from "@/lib/db";
import {
  agentListRepository,
  agentRepository,
  creditCostRepository,
  jobRepository,
  mapAgentWithIsNew,
  memberRepository,
  prisma,
} from "@/lib/db/repositories";
import { pricingAmountsSchema } from "@/lib/schemas";
import {
  AgentListType,
  AgentStatus,
  CreditCost,
  Prisma,
} from "@/prisma/generated/client";

export const agentService = (() => {
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
  const getAgentAccessContext = async (
    tx: Prisma.TransactionClient = prisma,
  ): Promise<{
    userOrganizationIds: string[];
    creditCosts: CreditCost[];
  }> => {
    const context = await getAuthContext();
    const creditCosts = await creditCostRepository.getCreditCosts(tx);
    const userOrganizationIds = context?.userId
      ? await memberRepository.getMembersOrganizationIdsByUserId(
          context.userId,
          tx,
        )
      : [];
    return { userOrganizationIds, creditCosts };
  };

  /**
   * Retrieves agents by list type for the current user with access control applied.
   *
   * @param type - The type of agent list to retrieve (e.g., FAVORITE).
   * @returns Promise resolving to array of agents with relations.
   */
  const getAgentsByListType = async (
    type: AgentListType,
  ): Promise<AgentWithRelations[]> => {
    const context = await getAuthContext();
    if (!context) {
      return [];
    }
    return await prisma.$transaction(async (tx) => {
      const existingList = await agentListRepository.getAgentListByUserId(
        context.userId,
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
        context.userId,
        type,
        tx,
      );
      return list.agents.map(mapAgentWithIsNew);
    });
  };

  /**
   * This function rounds up the total cents to show credits as integer.
   * Adds the difference to the total fee.
   * @param totalCents - The total cents to round up.
   * @param totalFee - The total fee.
   * @returns The rounded total cents with fee and the total fee which also includes difference.
   */
  const roundUpTotalCents = (
    totalCents: bigint,
    totalFee: bigint,
  ): [bigint, bigint] => {
    const totalCentsWithFee = totalCents + totalFee;
    const roundedTotalCentsWithFee = convertCreditsToCents(
      Math.ceil(convertCentsToCredits(totalCentsWithFee)),
    );
    const diff = roundedTotalCentsWithFee - totalCentsWithFee;
    return [roundedTotalCentsWithFee, totalFee + diff];
  };

  // Public API
  return {
    /**
     * Retrieves all agents marked as favorites for the current user.
     *
     * @returns Promise resolving to array of favorite agents with relations.
     * @throws If no active user session is found.
     */
    getFavoriteAgents: async (): Promise<AgentWithRelations[]> => {
      return await getAgentsByListType(AgentListType.FAVORITE);
    },

    /**
     * Retrieves all online agents available to the current user with valid pricing.
     *
     * @param tx - Optional Prisma transaction client.
     * @returns Array of available agents with valid pricing.
     */
    getAvailableAgents: async (): Promise<AgentWithRelations[]> => {
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
    getAvailableAgentById: async (
      agentId: string,
      tx: Prisma.TransactionClient = prisma,
    ): Promise<AgentWithRelations | null> => {
      const agent = await agentRepository.getShownAgentWithRelationById(
        agentId,
        AgentStatus.ONLINE,
        tx,
      );
      if (!agent) return null;
      const { userOrganizationIds, creditCosts } =
        await getAgentAccessContext(tx);
      if (!isAgentAvailable(agent, userOrganizationIds, creditCosts))
        return null;
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
    getAvailableAgentsWithCreditsPrice: async (): Promise<
      AgentWithCreditsPrice[]
    > => {
      const agents = await agentService.getAvailableAgents();
      const results = await Promise.allSettled(
        agents.map(async (agent) => {
          const agentWithCreditsPrice =
            await agentService.getAgentCreditsPrice(agent);
          return agentWithCreditsPrice;
        }),
      );
      return results
        .filter(
          (result): result is PromiseFulfilledResult<AgentWithCreditsPrice> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value);
    },

    /**
     * Retrieves a random available agent with its calculated credit price.
     * And the average execution duration of the agent.
     *
     * @returns Promise resolving to an agent with its calculated credit price, or null if no agents are available.
     */
    getRandomAvailableAgentData: async (): Promise<{
      agent: AgentWithCreditsPrice;
      averageExecutionDuration: number;
    } | null> => {
      const agents = await agentService.getAvailableAgents();
      if (agents.length === 0) {
        return null;
      }
      const randomIndex = Math.floor(Math.random() * agents.length);
      const agent = agents[randomIndex];
      const agentWithCreditsPrice =
        await agentService.getAgentCreditsPrice(agent);
      const averageExecutionDuration =
        await jobRepository.getAverageExecutionDurationByAgentId(agent.id);
      return { agent: agentWithCreditsPrice, averageExecutionDuration };
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
    getHiredAgents: async (): Promise<AgentWithJobs[]> => {
      const context = await getAuthContext();
      if (!context) {
        return [];
      }
      const hiredAgentsWithJobs =
        await agentRepository.getHiredAgentsWithJobsByUserIdAndOrganization(
          context.userId,
          context.organizationId,
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
     * Calculates the total credit price (in cents) for an agent, including any applicable fee.
     *
     * - Sums the cost of all fixed pricing units for the agent, using the current credit cost per unit.
     * - Applies a fee percentage (from NEXT_PUBLIC_FEE_PERCENTAGE) to the total cost.
     * - Ensures the total fee is at least the minimum fee (MIN_FEE_CREDITS).
     * - Returns the agent object extended with a `creditsPrice` field containing the total price and included fee.
     *
     * @param agent - The agent with pricing and relations data.
     * @param tx - Optional Prisma transaction client for DB operations (defaults to main Prisma client).
     * @returns The agent object with an added `creditsPrice` property.
     * @throws If the fee percentage is negative or if a credit cost for a unit is not found.
     */
    getAgentCreditsPrice: async (
      agent: AgentWithRelations,
      tx: Prisma.TransactionClient = prisma,
    ): Promise<AgentWithCreditsPrice> => {
      const amounts = agent.pricing?.fixedPricing?.amounts?.map((amount) => ({
        unit: amount.unit,
        amount: Number(amount.amount),
      }));
      if (!amounts) {
        return {
          ...agent,
          creditsPrice: { cents: BigInt(0), includedFee: BigInt(0) },
        };
      }
      const feePercentagePoints =
        getEnvPublicConfig().NEXT_PUBLIC_FEE_PERCENTAGE;
      if (feePercentagePoints < 0) {
        throw new Error(
          "Added fee percentage must be equal to or greater than 0",
        );
      }
      const feeMultiplier = feePercentagePoints / 100;
      const amountsParsed = pricingAmountsSchema.parse(amounts);

      let totalCents = BigInt(0);
      let totalFee = BigInt(0);
      const minFeeCents = convertCreditsToCents(
        getEnvSecrets().MIN_FEE_CREDITS,
      );
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
      const [totalCentsWithFee, updatedTotalFee] = roundUpTotalCents(
        totalCents,
        totalFee,
      );

      return {
        ...agent,
        creditsPrice: {
          cents: totalCentsWithFee,
          includedFee: updatedTotalFee,
        },
      };
    },
  };
})();
