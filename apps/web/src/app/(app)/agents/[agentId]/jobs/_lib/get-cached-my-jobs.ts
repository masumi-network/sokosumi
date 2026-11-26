import type { JobSummary } from "@sokosumi/core-client";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import { getAgentName } from "@/lib/helpers/agent";

const PAGE_SIZE = 20;

export interface OwnedAgentJobsPage {
  jobs: JobSummary[];
  nextCursor: string | null;
  /** All of the viewer's jobs with this agent in the active workspace. */
  total: number;
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
    total: response.meta?.pagination?.total ?? response.data.length,
  };
}

export const getCachedMyJobs = cache(
  async (agentId: string): Promise<OwnedAgentJobsPage> => {
    return getOwnedAgentJobsPage(agentId);
  },
);

/**
 * How many jobs the viewer ran with this agent in the active workspace. Same
 * Core query and scope as the jobs list, so the agent page's count matches
 * the list it links to. One row is fetched; Core counts the rest.
 *
 * Returns 0 when Core refuses the list (no seat, no workspace, unknown agent),
 * so the agent page simply shows no link.
 */
export async function getOwnedAgentJobsCount(agentId: string): Promise<number> {
  try {
    const response = await coreClient.getAgentJobs(agentId, {
      limit: 1,
      scope: "owned",
    });
    return response.meta?.pagination?.total ?? response.data.length;
  } catch (error) {
    if (
      error instanceof CoreApiRequestError &&
      (error.status === 401 || error.status === 403 || error.status === 404)
    ) {
      return 0;
    }
    throw error;
  }
}

/**
 * A delisted agent's name as the viewer's newest own job recorded it, so its
 * jobs page can still say whose jobs these are. Reads only the viewer's own
 * job, which they may open anyway. Null when they have none or Core refuses.
 */
export const getLastKnownAgentName = cache(
  async (agentId: string): Promise<string | null> => {
    try {
      const [newest] = (await getCachedMyJobs(agentId)).jobs;
      if (!newest) return null;
      const { data } = await coreClient.getJobById(newest.id);
      return data.agent.id === agentId ? getAgentName(data.agent) : null;
    } catch (error) {
      unstable_rethrow(error);
      return null;
    }
  },
);
