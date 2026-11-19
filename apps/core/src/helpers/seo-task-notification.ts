import type { Prisma } from "@sokosumi/database";

type AnalysisResult = {
  kind: string;
  status: string;
  auditId: string | null;
  projectId: string | null;
};

export async function hasImportedSeoTaskResult(
  client: Pick<Prisma.TransactionClient, "projectSeoObservation">,
  taskId: string,
  analysis: AnalysisResult,
): Promise<boolean> {
  if (analysis.status !== "completed") return false;
  const observation = await client.projectSeoObservation.findFirst({
    where: {
      source: "seo_coworker",
      sourceTaskId: taskId,
      kind: analysis.kind,
      auditId: analysis.auditId,
      projectId: analysis.projectId,
    },
    select: { id: true },
  });
  return Boolean(observation);
}

/** True when an imported result exists, null when a linked analysis can import later, false for an unrelated Task. */
export async function seoTaskResultHint(
  client: Prisma.TransactionClient,
  workspaceId: string,
  taskId: string,
): Promise<boolean | null> {
  const analysis = await client.projectSeoAnalysis.findFirst({
    where: {
      taskId,
      OR: [
        { audit: { workspaceId, deletedAt: null, archivedAt: null } },
        { project: { workspaceId } },
      ],
    },
    select: { status: true, kind: true, auditId: true, projectId: true },
  });
  if (!analysis) return false;
  return (await hasImportedSeoTaskResult(client, taskId, analysis)) || null;
}
