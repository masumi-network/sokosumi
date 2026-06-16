import "server-only";

import { mapCoreMyAgentReview } from "@/lib/agents/core-dto-mappers";
import { getAllCoreAgents, getCoreAgentById } from "@/lib/agents/core-loaders";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { Agent, AgentDetail } from "@/lib/clients/generated/core";
import type { CoreAgentDto } from "@/lib/types/core-dto";

export const agentService = (() => {
  return {
    getAvailableAgentById: async (
      agentId: string,
    ): Promise<AgentDetail | null> => {
      return getCoreAgentById(agentId);
    },

    getAvailableAgentsWithCreditsPrice: async (): Promise<Agent[]> => {
      return getAllCoreAgents();
    },

    getRandomAvailableAgentData: async (): Promise<{
      agent: CoreAgentDto;
      averageExecutionDuration: number | null;
    } | null> => {
      const coreAgents = await getAllCoreAgents();
      if (coreAgents.length === 0) {
        return null;
      }
      const randomIndex = Math.floor(Math.random() * coreAgents.length);
      const coreAgent = coreAgents[randomIndex];
      return {
        agent: coreAgent,
        averageExecutionDuration: coreAgent.metrics.executions.averageTime,
      };
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
