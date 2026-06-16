import { cache } from "react";

import { coreClient } from "@/lib/clients/core.client";
import type { JobSummary } from "@/lib/types/core-dto";

const PAGE_SIZE = 100;

function sortJobsByCreatedAtDesc(jobs: JobSummary[]): JobSummary[] {
  return [...jobs].sort(
    (firstJob, secondJob) =>
      new Date(secondJob.createdAt).getTime() -
      new Date(firstJob.createdAt).getTime(),
  );
}

async function getAllOwnedAgentJobs(agentId: string): Promise<JobSummary[]> {
  const jobs: JobSummary[] = [];
  let cursor: string | undefined;

  do {
    const response = await coreClient.getAgentJobs(agentId, {
      cursor,
      limit: PAGE_SIZE,
      scope: "owned",
    });

    jobs.push(...response.data);

    cursor = response.meta?.pagination?.nextCursor ?? undefined;
  } while (cursor);

  return sortJobsByCreatedAtDesc(jobs);
}

export const getCachedMyJobs = cache(
  async (agentId: string): Promise<JobSummary[]> => {
    return getAllOwnedAgentJobs(agentId);
  },
);
