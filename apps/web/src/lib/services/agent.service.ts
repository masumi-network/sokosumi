import "server-only";

import { mapCoreMyAgentReview } from "@/lib/agents/core-dto-mappers";
import { getAllCoreAgents, getCoreAgentById } from "@/lib/agents/core-loaders";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  Agent,
  AgentDetail,
  CardanoAgentListItem,
} from "@/lib/clients/generated/core";

export const agentService = (() => {
  return {
    getAvailableAgentById: async (
      agentId: string,
    ): Promise<AgentDetail | null> => {
      return getCoreAgentById(agentId);
    },

    getAvailableAgentsWithCreditsPrice: async (): Promise<Agent[]> => {
      const items = await getAllCoreAgents();
      return items.filter(
        (item): item is CardanoAgentListItem => item.kind === "cardano",
      );
    },

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
