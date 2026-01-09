import type { Prisma } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import {
  jobWithCreditTransaction,
  jobWithEvents,
  jobWithPurchase,
} from "@sokosumi/database/types/job";

import type { AuthenticationContext } from "@/middleware/auth";
import { flattenJob } from "@/types/job";

/**
 * Retrieves jobs for the authenticated user, optionally filtered by agent ID.
 * Includes all job relations (events, credit transactions, purchases) and flattens the results.
 *
 * @param authContext - The authenticated user context
 * @param options - Query options
 * @param options.agentId - Optional agent ID to filter jobs by
 * @param options.tx - Optional Prisma transaction client for transaction support
 * @returns Array of flattened job objects
 *
 * @example
 * // Get all jobs for the user
 * const jobs = await getUserJobs(authContext);
 *
 * @example
 * // Get jobs for a specific agent
 * const jobs = await getUserJobs(authContext, { agentId: "agent_123" });
 *
 * @example
 * // Within a transaction
 * await prisma.$transaction(async (tx) => {
 *   const jobs = await getUserJobs(authContext, { agentId: "agent_123", tx });
 * });
 */
export async function getUserJobs(
  authContext: AuthenticationContext,
  options: {
    agentId?: string;
    tx?: Prisma.TransactionClient;
  } = {},
): Promise<ReturnType<typeof flattenJob>[]> {
  const { agentId, tx = prisma } = options;

  const jobs = await tx.job.findMany({
    where: {
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      ...(agentId ? { agentId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      ...jobWithEvents,
      ...jobWithCreditTransaction,
      ...jobWithPurchase,
    },
  });

  return jobs.map(flattenJob);
}
