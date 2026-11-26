import { reportObject } from "@/helpers/project-seo-public-report";
import { publicAuditRoots } from "@/helpers/seo-public-sitemaps";
import prisma from "@/lib/db/prisma";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { seoOwnerWhere } from "./project-seo-store";

export async function readPublicAuditSitemaps(
  actor: SeoActor,
  taskIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (actor.sokoBotId || !taskIds.length) return result;
  const rows = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      ownerId: null,
      source: "seo_coworker",
      kind: "audit_full",
      sourceTaskId: { in: taskIds },
      sourceFileId: { not: null },
    },
    select: {
      sourceTaskId: true,
      sourceFileId: true,
      sourceKey: true,
      payload: true,
    },
  });
  const candidates = rows.flatMap((row) => {
    const payload = reportObject(row.payload);
    const page = Array.isArray(payload?.pageUrls) && payload.pageUrls[0];
    if (
      !row.sourceFileId ||
      !row.sourceTaskId ||
      row.sourceKey !== `task-file:${row.sourceFileId}` ||
      payload?.kind !== "audit_full" ||
      payload.version !== 1 ||
      typeof page !== "string"
    )
      return [];
    const roots = publicAuditRoots(payload.publicSitemaps, page);
    return roots
      ? [{ fileId: row.sourceFileId, taskId: row.sourceTaskId, roots }]
      : [];
  });
  if (!candidates.length) return result;
  const files = await prisma.taskFile.findMany({
    where: {
      id: { in: candidates.map((item) => item.fileId) },
      task: {
        id: { in: taskIds },
        workspaceId: actor.workspaceId,
        ownerId: actor.userId,
        status: "COMPLETED",
        visibility: "PUBLIC",
        archivedAt: null,
      },
      status: "READY",
    },
    select: { id: true, taskId: true },
  });
  const delivered = new Map(files.map((file) => [file.id, file.taskId]));
  const ambiguous = new Set<string>();
  for (const { fileId, taskId, roots } of candidates) {
    if (delivered.get(fileId) !== taskId) continue;
    if (result.has(taskId)) ambiguous.add(taskId);
    result.set(taskId, roots);
  }
  for (const taskId of ambiguous) result.delete(taskId);
  return result;
}
