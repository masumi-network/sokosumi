import "server-only";

import type {
  AgentWithCreditsPrice,
  AgentWithRelations,
} from "@sokosumi/utils";

import {
  mapCoreAgentsToAgentWithCreditsPrice,
  mapCoreAgentToAgentWithCreditsPrice,
  mapCoreMyAgentReview,
} from "@/lib/agents/core-dto-mappers";
import { getAllCoreAgents, getCoreAgentById } from "@/lib/agents/core-loaders";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

export const agentService = (() => {
  // Public API
  return {
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
     * Check if the authenticated caller is eligible to rate an agent (has
     * finished at least one job with it).
     *
     * Served by Core's `GET /v1/agents/{id}/ratings/eligibility`. Returns false
     * when the agent is unavailable (Core 404).
     */
    async canUserRateAgent(agentId: string): Promise<boolean> {
      try {
        const response = await coreClient.getAgentRatingEligibility(agentId);
        return response.data.eligible;
      } catch (error) {
        if (error instanceof CoreApiRequestError && error.status === 404) {
          return false;
        }
        throw error;
      }
    },

    /**
     * Get the authenticated caller's existing rating for an agent.
     *
     * Served by Core's `GET /v1/agents/{id}/reviews/me`, which scopes the read
     * to the session user. Returns null when the agent is unavailable (Core 404)
     * or the caller has not rated it.
     */
    async getUserRatingForAgent(agentId: string) {
      try {
        const response = await coreClient.getMyAgentReview(agentId);
        return mapCoreMyAgentReview(response.data);
      } catch (error) {
        if (error instanceof CoreApiRequestError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  };
})();
