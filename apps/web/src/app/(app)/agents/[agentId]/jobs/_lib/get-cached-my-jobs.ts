import type { JobWithSokosumiStatus } from "@sokosumi/utils";
import { cache } from "react";

import { mapCoreJobSummaryToJobWithSokosumiStatus } from "@/lib/agents/core-dto-mappers";
import { coreClient } from "@/lib/clients/core.client";

const PAGE_SIZE = 100;

function sortJobsByCreatedAtDesc(
  jobs: JobWithSokosumiStatus[],
): JobWithSokosumiStatus[] {
  return [...jobs].sort(
    (firstJob, secondJob) =>
      new Date(secondJob.createdAt).getTime() -
      new Date(firstJob.createdAt).getTime(),
  );
}

async function getAllOwnedAgentJobs(
  agentId: string,
): Promise<JobWithSokosumiStatus[]> {
  const jobs: JobWithSokosumiStatus[] = [];
  let cursor: string | undefined;

  do {
    const response = await coreClient.getAgentJobs(agentId, {
      cursor,
      limit: PAGE_SIZE,
      scope: "owned",
    });

    jobs.push(
      ...response.data.map((job) =>
        mapCoreJobSummaryToJobWithSokosumiStatus(job),
      ),
    );

    cursor = response.meta?.pagination?.nextCursor ?? undefined;
  } while (cursor);

  return sortJobsByCreatedAtDesc(jobs);
}

/**
 * Cached wrapper for fetching all owned jobs for an agent from Core.
 * This prevents duplicate API requests when layout and parallel route pages
 * both need the same data.
 */
export const getCachedMyJobs = cache(
  async (agentId: string): Promise<JobWithSokosumiStatus[]> => {
    return getAllOwnedAgentJobs(agentId);
  },
);
