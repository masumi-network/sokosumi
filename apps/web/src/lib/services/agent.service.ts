import "server-only";

import {
  AgentListType,
  type AgentWithCreditsPrice,
  type AgentWithJobs,
  type AgentWithPricing,
  type AgentWithRelations,
  type CreditCost,
  PricingType,
} from "@sokosumi/database";
import {
  agentListRepository,
  agentRatingRepository,
  agentRepository,
  creditCostRepository,
  jobRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";

import {
  mapCoreAgentsToAgentWithCreditsPrice,
  mapCoreAgentToAgentWithCreditsPrice,
} from "@/lib/agents/core-dto-mappers";
import { getAllCoreAgents, getCoreAgentById } from "@/lib/agents/core-loaders";
import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";

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
    ): Promise<AgentWithRelations | null> => {
      // Core returns 404 (→ null) for agents that are not available, matching
      // the previous DB-side availability gate.
      const coreAgent = await getCoreAgentById(agentId);
      if (!coreAgent) return null;
      return mapCoreAgentToAgentWithCreditsPrice(coreAgent);
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
      // Core already computes per-agent credits; the mapper carries them onto
      // the AgentWithCreditsPrice shape consumers expect.
      const coreAgents = await getAllCoreAgents();
      return mapCoreAgentsToAgentWithCreditsPrice(coreAgents);
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
      const coreAgents = await getAllCoreAgents();
      if (coreAgents.length === 0) {
        return null;
      }
      const randomIndex = Math.floor(Math.random() * coreAgents.length);
      const coreAgent = coreAgents[randomIndex];
      return {
        agent: mapCoreAgentToAgentWithCreditsPrice(coreAgent),
        averageExecutionDuration: coreAgent.metrics.executions.averageTime,
      };
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
