import "server-only";

import { cache } from "react";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  Agent as CoreAgent,
  AgentDetail as CoreAgentDetail,
} from "@/lib/clients/generated/core";

const AGENTS_PAGE_SIZE = 100;

export const getCoreAgentById = cache(
  async (agentId: string): Promise<CoreAgentDetail | null> => {
    try {
      const response = await coreClient.getAgentById(agentId);
      return response.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }

      throw error;
    }
  },
);

export const getAllCoreAgents = cache(async (): Promise<CoreAgent[]> => {
  const agents: CoreAgent[] = [];
  let cursor: string | undefined;

  // TODO(core-api): replace all-page loading after Core supports gallery search
  // and a pagination strategy that preserves the current filter UX.
  do {
    const response = await coreClient.getAgents({
      cursor,
      limit: AGENTS_PAGE_SIZE,
    });

    agents.push(...response.data);
    cursor = response.meta?.pagination?.nextCursor ?? undefined;
  } while (cursor);

  return agents;
});
