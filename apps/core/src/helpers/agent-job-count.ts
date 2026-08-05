import type { Prisma } from "@sokosumi/database";

/**
 * Increments Agent.jobCount by 1 for a newly created Job.
 * Must run in the same transaction as `tx.job.create`.
 */
export async function incrementAgentJobCount(
  agentId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.agent.update({
    where: { id: agentId },
    data: { jobCount: { increment: 1 } },
  });
}
