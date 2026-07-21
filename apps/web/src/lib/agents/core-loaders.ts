import "server-only";

import { cache } from "react";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  Agent as CoreAgent,
  AgentDetail as CoreAgentDetail,
} from "@/lib/clients/generated/core";

const AGENTS_PAGE_SIZE = 100;

// The agent catalog is global and changes infrequently. Without cross-request
// caching, every page that needs agents re-paginates the whole catalog over
// HTTP (React `cache()` only dedupes within a single request). Cache the
// underlying fetches with a short TTL + tag so the catalog is fetched at most
// once per window across all requests; call `updateTag(AGENTS_CACHE_TAG)` from
// a Server Action to invalidate on demand (e.g. after admin overwrite edits).
const AGENTS_CACHE_REVALIDATE_SECONDS = 60;
export const AGENTS_CACHE_TAG = "core-agents-catalog";

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
    const response = await coreClient.getAgents(
      {
        cursor,
        limit: AGENTS_PAGE_SIZE,
      },
      {
        revalidate: AGENTS_CACHE_REVALIDATE_SECONDS,
        tags: [AGENTS_CACHE_TAG],
      },
    );

    agents.push(...response.data);
    cursor = response.meta?.pagination?.nextCursor ?? undefined;
  } while (cursor);

  return agents;
});
