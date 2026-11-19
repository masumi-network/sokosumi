import type { Prisma } from "@sokosumi/database";

export async function hasSeoTaskResult(
  client: Prisma.TransactionClient,
  workspaceId: string,
  taskId: string,
): Promise<boolean> {
  return Boolean(
    await client.projectSeoAnalysis.findFirst({
      where: {
        taskId,
        OR: [
          { audit: { workspaceId, deletedAt: null, archivedAt: null } },
          { project: { workspaceId } },
        ],
      },
      select: { id: true },
    }),
  );
}
