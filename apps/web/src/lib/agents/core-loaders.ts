import "server-only";

import { cache } from "react";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  Agent as CoreAgent,
  AgentDetail as CoreAgentDetail,
  Category as CoreCategory,
} from "@/lib/clients/generated/core";

const AGENTS_PAGE_SIZE = 100;

// The agent + category catalogs are global and change infrequently. Without
// cross-request caching, every page that needs them re-fetches over HTTP
// (React `cache()` only dedupes within a single request). Opt into fetch-level
// revalidation + tags so payloads are shared across users (URL-keyed; no
// per-user fields). Invalidate with `updateTag(...)` from Server Actions.
//
// Full cookie-free `'use cache'` fill is blocked until Core offers a public or
// service-token catalog read — `coreClient` forwards session cookies via
// `headers()`, which is illegal inside `'use cache'`. Callers that run under
// Cache Components Suspense should `await connection()` first so prerender
// does not soft-reject `headers()` while probing the boundary.
const CATALOG_CACHE_REVALIDATE_SECONDS = 60;
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
        revalidate: CATALOG_CACHE_REVALIDATE_SECONDS,
        tags: [AGENTS_CACHE_TAG],
      },
    );

    agents.push(...response.data);
    cursor = response.meta?.pagination?.nextCursor ?? undefined;
  } while (cursor);

  return agents;
});

export const getCoreCategories = cache(async (): Promise<CoreCategory[]> => {
  const response = await coreClient.getCategories(undefined, {
    revalidate: CATALOG_CACHE_REVALIDATE_SECONDS,
    tags: [CATEGORIES_CACHE_TAG],
  });

  return response.data;
});
