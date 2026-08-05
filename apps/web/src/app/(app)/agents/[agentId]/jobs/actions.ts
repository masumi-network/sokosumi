"use server";

import { getOwnedAgentJobsPage } from "@/app/agents/[agentId]/jobs/_lib/get-cached-my-jobs";

export async function loadMoreOwnedAgentJobs(
  agentId: string,
  cursor: string | null,
) {
  const cleanAgentId = agentId.trim();
  if (!cleanAgentId || !cursor?.trim()) {
    return { jobs: [], nextCursor: null as string | null };
  }

  return getOwnedAgentJobsPage(cleanAgentId, cursor.trim());
}
