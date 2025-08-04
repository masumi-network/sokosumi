import "server-only";

import { JobStatusData } from "@/lib/ably";
import { getSessionOrThrow } from "@/lib/auth/utils";
import { getJobStatusData } from "@/lib/db";
import { jobRepository, prisma } from "@/lib/db/repositories";
import { Prisma } from "@/prisma/generated/client";

/**
 * Get the latest job's JobStatusData for each agent
 * @param agentIds - The IDs of the agents to get the latest job status for
 * @param tx - The transaction client to use for the database operations
 * @returns The latest job's JobStatusData for each agent
 */
export async function getAgentJobStatusDataListByAgentIds(
  agentIds: string[],
  tx: Prisma.TransactionClient = prisma,
): Promise<(JobStatusData | null)[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;
  const activeOrganizationId = session.session.activeOrganizationId;

  return await Promise.all(
    agentIds.map(async (agentId) => {
      const latestJob =
        await jobRepository.getLatestJobByAgentIdUserIdAndOrganization(
          agentId,
          userId,
          activeOrganizationId,
          tx,
        );
      if (!latestJob) {
        return null;
      }
      return getJobStatusData(latestJob);
    }),
  );
}
