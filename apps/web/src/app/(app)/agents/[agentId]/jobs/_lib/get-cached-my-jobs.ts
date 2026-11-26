import type { JobSummary } from "@sokosumi/core-client";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

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

/** Most job reads one jobs page may spend looking for a delisted agent's name. */
export const LAST_KNOWN_NAME_JOB_READS = 3;

/**
 * A delisted agent's name as the viewer's own jobs recorded it, so its jobs
 * page can still say whose jobs these are.
 *
 * Data contract: a job summary (the jobs list) carries no agent name, so
 * the name comes from job detail (`GET /v1/jobs/:id`, `agent.overrideName`
 * else `agent.name`), which Core resolves even for an agent that left the
 * catalog. Only the viewer's own jobs from the list already loaded are read,
 * newest first, and a job is used only when its agent is this agent and its
 * name is not blank.
 *
 * Limit: at most `LAST_KNOWN_NAME_JOB_READS` reads, in parallel, and the
 * newest job that names the agent wins. When none of those newest jobs
 * carries a name, the page says "Unavailable agent", even if an older job
 * outside that window would have one.
 */
export const getLastKnownAgentName = cache(
  async (agentId: string): Promise<string | null> => {
    let jobs: JobSummary[];
    try {
      ({ jobs } = await getCachedMyJobs(agentId));
    } catch (error) {
      unstable_rethrow(error);
      return null;
    }
    const names = await Promise.all(
      jobs.slice(0, LAST_KNOWN_NAME_JOB_READS).map(async (job) => {
        try {
          const { agent } = (await coreClient.getJobById(job.id)).data;
          if (agent.id !== agentId) return null;
          return agent.overrideName?.trim() || agent.name.trim() || null;
        } catch (error) {
          unstable_rethrow(error);
          return null;
        }
      }),
    );
    return names.find((name) => name !== null) ?? null;
  },
);
