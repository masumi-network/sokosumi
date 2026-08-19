import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { cache } from "react";
import { coreCatalogClient } from "@/lib/clients/core.catalog.client";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  Agent as CoreAgent,
  AgentDetail as CoreAgentDetail,
  X402Agent as CoreX402Agent,
} from "@/lib/clients/generated/core";

const AGENTS_PAGE_SIZE = 100;

// Global agent catalog carries no per-user fields. Fill via the cookie-free
// catalog client inside `'use cache'` so Cache Components can share payloads
// across requests. Invalidate with `updateTag(...)` from Server Actions.
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

export async function getAllCoreAgents(): Promise<CoreAgent[]> {
  "use cache";
  cacheTag(AGENTS_CACHE_TAG);
  cacheLife("minutes");

  const agents: CoreAgent[] = [];
  let cursor: string | undefined;

  // TODO(core-api): replace all-page loading after Core supports gallery search
  // and a pagination strategy that preserves the current filter UX.
  do {
    // Core omit = both rails. Generated GetAgentsData on this SHA has no
    // `kind`; extra query keys still serialize. Snapshot regen is #3785.
    const query = {
      cursor,
      kind: ["cardano"],
      limit: AGENTS_PAGE_SIZE,
    };
    const response = await coreCatalogClient.getAgents(query);

    for (const item of response.data) {
      if ((item as { kind?: unknown }).kind === "x402") {
        continue;
      }
      agents.push(item);
    }
    cursor = response.meta?.pagination?.nextCursor ?? undefined;
  } while (cursor);

  return agents;
}

export async function getAllCoreX402Agents(): Promise<CoreX402Agent[]> {
  const agents: CoreX402Agent[] = [];
  let cursor: string | undefined;

  // x402 pages can be empty while still carrying a next cursor because
  // fail-closed payment checks run after candidate pagination. Always follow
  // the cursor until Core says the candidate set is exhausted.
  do {
    const response = await coreClient.getX402Agents({
      cursor,
      limit: AGENTS_PAGE_SIZE,
    });

    agents.push(...response.data);
    cursor = response.meta?.pagination?.nextCursor ?? undefined;
  } while (cursor);

  return agents;
}
