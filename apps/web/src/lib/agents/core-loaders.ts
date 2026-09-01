import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { cache } from "react";
import { coreCatalogClient } from "@/lib/clients/core.catalog.client";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  AgentListItem,
  AgentDetail as CoreAgentDetail,
  Category as CoreCategory,
} from "@/lib/clients/generated/core";

const AGENTS_PAGE_SIZE = 100;

// Global agent + category catalogs carry no per-user fields. Fill via the
// cookie-free catalog client inside `'use cache'` so Cache Components can share
// payloads across requests. Invalidate with `updateTag(...)` from Server Actions.
export const AGENTS_CACHE_TAG = "core-agents-catalog";
export const CATEGORIES_CACHE_TAG = "core-categories-catalog";

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

export async function getAllCoreAgents(): Promise<AgentListItem[]> {
  "use cache";
  cacheTag(AGENTS_CACHE_TAG);
  cacheLife("minutes");

  const agents: AgentListItem[] = [];
  let cursor: string | undefined;

  // TODO(core-api): replace all-page loading after Core supports gallery search
  // and a pagination strategy that preserves the current filter UX.
  do {
    const response = await coreCatalogClient.getAgents({
      cursor,
      kind: ["cardano", "x402"],
      limit: AGENTS_PAGE_SIZE,
    });

    agents.push(...response.data);
    cursor = response.meta?.pagination?.nextCursor ?? undefined;
  } while (cursor);

  return agents;
}

export async function getCoreCategories(): Promise<CoreCategory[]> {
  "use cache";
  cacheTag(CATEGORIES_CACHE_TAG);
  cacheLife("minutes");

  const response = await coreCatalogClient.getCategories();
  return response.data;
}
