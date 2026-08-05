import { cache } from "react";

import { coreClient } from "@/lib/clients/core.client";
import type { JobSummary } from "@/lib/clients/generated/core";

const PAGE_SIZE = 20;

export interface OwnedAgentJobsPage {
  jobs: JobSummary[];
  nextCursor: string | null;
}

export async function getOwnedAgentJobsPage(
  agentId: string,
  cursor?: string | null,
): Promise<OwnedAgentJobsPage> {
  const response = await coreClient.getAgentJobs(agentId, {
    ...(cursor ? { cursor } : {}),
    limit: PAGE_SIZE,
    scope: "owned",
  });

  return {
    jobs: response.data,
    nextCursor: response.meta?.pagination?.nextCursor ?? null,
  };
}

export const getCachedMyJobs = cache(
  async (agentId: string): Promise<OwnedAgentJobsPage> => {
    return getOwnedAgentJobsPage(agentId);
  },
);
