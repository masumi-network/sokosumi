import "server-only";

import {
  AgentListType,
  AgentStatus,
  type AgentWithCreditsPrice,
  type AgentWithJobs,
  type AgentWithPricing,
  type AgentWithRelations,
  type CreditCost,
  PricingType,
  type Prisma,
} from "@sokosumi/database";
import {
  agentListRepository,
  agentRatingRepository,
  agentRepository,
  creditCostRepository,
  jobRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";

import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { getAgentPricingAmounts } from "@/lib/helpers/agent";
import { pricingAmountsSchema } from "@/lib/schemas";

export const agentService = (() => {
  /**
   * Utility: Checks if an agent is visible in the catalog.
   */
  function canUserAccessAgent(agent: AgentWithRelations): boolean {
    return agent.isShown;
  }

  /**
   * Utility: Checks if an agent's pricing unit values are all valid according to the provided credit costs.
   *
   * @param agent - Agent with pricing information.
   * @param creditCosts - Array of valid credit cost objects.
   * @returns True if all pricing units are valid or if there are no amounts, false otherwise.
   */
  function hasValidPricing(
    agent: AgentWithPricing,
    creditCosts: CreditCost[],
  ): boolean {
    switch (agent.pricing.pricingType) {
      case PricingType.FIXED: {
        const units = creditCosts.map(({ unit }) => unit);
        const amounts = agent.pricing.fixedPricing?.amounts?.map((amount) => ({
          unit: amount.unit,
          amount: amount.amount,
        }));
        if (!amounts) {
          // There must be fixedPricing for FIXED pricing type
          return false;
        }

        const areAmountsValid = amounts.every(
          ({ unit, amount }) => units.includes(unit) && amount > 0,
        );
        return areAmountsValid;
      }
      case PricingType.FREE: {
        return true;
      }
      case PricingType.UNKNOWN: {
        return false;
      }
    }
  }

  /**
   * Utility: Determines if an agent is available to the user based on access permissions and pricing validity.
   *
   * @param agent - Agent with relations including pricing data.
   * @param creditCosts - Valid credit cost objects for pricing validation.
   * @returns True if the agent is available to the user, false otherwise.
   */
  function isAgentAvailable(
    agent: AgentWithRelations,
    creditCosts: CreditCost[],
  ): boolean {
    return canUserAccessAgent(agent) && hasValidPricing(agent, creditCosts);
  }

  /**
   * Retrieves online agents and their credit costs, then applies shared availability filtering.
   */
  async function getAvailableOnlineAgentsAndCreditCosts(
    tx: Prisma.TransactionClient,
  ): Promise<{
    availableAgents: AgentWithRelations[];
    creditCosts: CreditCost[];
  }> {
    const creditCosts = await creditCostRepository.getCreditCosts(tx);
    const onlineAgents =
      await agentRepository.getShownAgentsWithRelationsByStatus(
        AgentStatus.ONLINE,
        tx,
      );
    const availableAgents = onlineAgents.filter((agent) =>
      isAgentAvailable(agent, creditCosts),
    );

    return {
      availableAgents,
      creditCosts,
    };
  }

  /**
   * Builds a fast lookup map for credit costs by unit.
   */
  function buildCreditCostByUnitMap(
    creditCosts: CreditCost[],
  ): Map<string, bigint> {
    return new Map(
      creditCosts.map((creditCost) => [
        creditCost.unit,
        creditCost.centsPerUnit,
      ]),
    );
  }

  /**
   * Computes the total credits price for an agent from preloaded credit costs.
   */
  function computeAgentCreditsPriceCents(
    agent: AgentWithRelations,
    creditCostByUnit: Map<string, bigint>,
  ): bigint {
    const amounts = getAgentPricingAmounts(agent);
    if (!amounts) {
      throw new Error("Agent has invalid or unknown pricing");
    }

    // if amounts is empty (in case of free agent)
    if (amounts.length === 0) {
      return BigInt(0);
    }

    const amountsParsed = pricingAmountsSchema.parse(amounts);

    let totalCents = BigInt(0);
    for (const amount of amountsParsed) {
      const centsPerUnit = creditCostByUnit.get(amount.unit);
      if (centsPerUnit === undefined) {
        throw new Error(`Credit cost not found for unit ${amount.unit}`);
      }
      const cents = amount.amount * centsPerUnit;
      totalCents += cents;
    }

    return totalCents;
  }

  /**
   * Retrieves agents by list type for the current user with access control applied.
   *
   * @param type - The type of agent list to retrieve (e.g., FAVORITE).
   * @returns Promise resolving to array of agents with relations.
   */
  const getAgentsByListType = async (
    type: AgentListType,
  ): Promise<AgentWithRelations[]> => {
    const session = await getSession();
    if (!session) {
      return [];
    }
    // Sidebar list is nice-to-have, not load-bearing — same defense as
    // breadcrumb-navigation: on Neon cold-start timeouts we surface an empty
    // list rather than throwing into the React tree (which Next's dev overlay
    // surfaces and which boots users out of /hermes).
    return await prisma
      .$transaction(async (tx) => {
        const list = await agentListRepository.upsertAgentListForUserId(
          session.user.id,
          type,
          tx,
        );
        const creditCosts = await creditCostRepository.getCreditCosts(tx);
        return list.agents.filter((agent) =>
          isAgentAvailable(agent, creditCosts),
        );
      })
      .catch((error) => {
        console.warn(
          "[agent.service] getAgentsByListType timed out, using empty fallback",
          { type, message: (error as Error)?.message },
        );
        return [] as AgentWithRelations[];
      });
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
      // Reads only — no need for an interactive transaction. Neon pooled
      // connections frequently time out on `prisma.$transaction(async (tx) => ...)`
      // for read-only work because each interactive transaction reserves a
      // dedicated session from a small pool. Plain reads sidestep that.
      const { availableAgents } =
        await getAvailableOnlineAgentsAndCreditCosts(prisma);
      return availableAgents;
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
      const creditCosts = await creditCostRepository.getCreditCosts(tx);
      if (!isAgentAvailable(agent, creditCosts)) return null;
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
      // Reads only — see note on getAvailableAgents above. Plain reads avoid
      // Neon pooled-connection transaction-acquisition timeouts.
      const { availableAgents, creditCosts } =
        await getAvailableOnlineAgentsAndCreditCosts(prisma);
      const creditCostByUnit = buildCreditCostByUnitMap(creditCosts);

      const agentsWithCreditsPrice: AgentWithCreditsPrice[] = [];
      for (const agent of availableAgents) {
        try {
          const creditsPriceCents = computeAgentCreditsPriceCents(
            agent,
            creditCostByUnit,
          );
          agentsWithCreditsPrice.push({
            ...agent,
            creditsPrice: {
              cents: creditsPriceCents,
            },
          });
        } catch {}
      }

      return agentsWithCreditsPrice;
    },

    /**
     * Retrieves a random available agent with its calculated credit price.
     * And the average execution duration of the agent.
     *
     * @returns Promise resolving to an agent with its calculated credit price, or null if no agents are available.
     */
    getRandomAvailableAgentData: async (): Promise<{
      agent: AgentWithCreditsPrice;
      averageExecutionDuration: number | null;
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
        await jobRepository.getAverageExecutionDurationByAgentId(
          agent.id,
          prisma,
        );
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
      const session = await getSession();
      if (!session) {
        return [];
      }
      const workspace = await workspaceRepository.upsertWorkspaceForContext(
        session.user.id,
        session.session.activeOrganizationId ?? null,
        prisma,
      );
      const hiredAgentsWithJobs =
        await agentRepository.getHiredAgentsWithLatestJobByUserIdAndWorkspace(
          session.user.id,
          workspace.id,
          prisma,
        );
      return hiredAgentsWithJobs.sort((a, b) => {
        const aLatestJob = a.jobs[0];
        const bLatestJob = b.jobs[0];
        if (!aLatestJob) return 1;
        if (!bLatestJob) return -1;
        return bLatestJob.createdAt.getTime() - aLatestJob.createdAt.getTime();
      });
    },

    /**
     * Calculates the total credit price (in cents) for an agent.
     *
     * - Sums the cost of all fixed pricing units for the agent, using the current credit cost per unit.
     * - Returns the agent object extended with a `creditsPrice` field containing the total price.
     *
     * @param agent - The agent with pricing and relations data.
     * @param tx - Optional Prisma transaction client for DB operations (defaults to main Prisma client).
     * @returns The agent object with an added `creditsPrice` property.
     * @throws If a credit cost for a unit is not found or if the agent has invalid or unknown pricing.
     */
    getAgentCreditsPrice: async (
      agent: AgentWithRelations,
      tx: Prisma.TransactionClient = prisma,
    ): Promise<AgentWithCreditsPrice> => {
      const creditCosts = await creditCostRepository.getCreditCosts(tx);
      const creditCostByUnit = buildCreditCostByUnitMap(creditCosts);
      const totalCents = computeAgentCreditsPriceCents(agent, creditCostByUnit);

      return {
        ...agent,
        creditsPrice: {
          cents: totalCents,
        },
      };
    },

    /**
     * Submit a rating for an agent (create or update)
     */
    async submitAgentRating(
      agentId: string,
      rating: number,
      comment: string | null = null,
    ): Promise<void> {
      const session = await getSession();
      if (!session) {
        throw new Error("User not found");
      }
      const userId = session.user.id;

      // Validate rating
      if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        throw new Error("Rating must be an integer between 1 and 5");
      }

      await prisma.$transaction(async (tx) => {
        // Check if user has finished any jobs with this agent
        const hasFinishedJob =
          await jobRepository.doesUserHaveFinishedJobWithAgent(
            userId,
            agentId,
            tx,
          );

        if (!hasFinishedJob) {
          throw new Error(
            "User must finish at least one job with this agent before rating",
          );
        }

        // Upsert the rating
        await agentRatingRepository.upsertRating(
          userId,
          agentId,
          rating,
          comment,
          tx,
        );
      });
    },

    /**
     * Check if user can rate an agent
     */
    async canUserRateAgent(userId: string, agentId: string): Promise<boolean> {
      return await jobRepository.doesUserHaveFinishedJobWithAgent(
        userId,
        agentId,
        prisma,
      );
    },

    /**
     * Get user's existing rating for an agent
     */
    async getUserRatingForAgent(userId: string, agentId: string) {
      return await agentRatingRepository.getUserRatingForAgent(
        userId,
        agentId,
        prisma,
      );
    },

    /**
     * Get paginated ratings for an agent
     */
    async getAgentRatings(
      agentId: string,
      limit: number = 10,
      offset: number = 0,
    ) {
      return await agentRatingRepository.getRatingsByAgentId(
        agentId,
        limit,
        offset,
        false,
        prisma,
      );
    },

    /**
     * Get aggregate rating statistics for an agent
     */
    async getAgentRatingStats(agentId: string) {
      return await agentRatingRepository.getAgentRatingStats(agentId, prisma);
    },
  };
})();
