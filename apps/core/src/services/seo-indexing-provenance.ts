import type { ProjectSeoObservation } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import { googleReturnedUnknown } from "@/lib/seo/inspection-provenance";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  type SeoTaskIndexingResult,
  seoTaskIndexingResultSchema,
} from "@/schemas/seo-task-indexing.schema";
import { seoOwnerWhere } from "./project-seo-store";
import {
  hasSavedSeoIndexingAssessment,
  storedReceiptSchema,
} from "./seo-task-indexing-receipt";

/** Legacy results lack provenance. Only their original, owner-private Google receipt can supply it. */
export async function projectLegacyIndexingProvenance(
  actor: SeoActor,
  rows: ProjectSeoObservation[],
) {
  const candidates = new Map<
    string,
    { row: ProjectSeoObservation; result: SeoTaskIndexingResult }
  >();
  for (const row of rows) {
    const parsed = seoTaskIndexingResultSchema.safeParse(row.payload);
    if (!parsed.success) continue;
    const result = parsed.data;
    if (
      row.sourceKey ===
        `task-index-triage:${result.taskId}:${result.receiptHash}` &&
      result.assessments.some(
        (page) => page.status === "unavailable" && !page.googleReturnedUnknown,
      )
    )
      candidates.set(result.receiptHash, { row, result });
  }
  if (!candidates.size) return rows;
  const receipts = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      ownerId: actor.userId,
      visibility: "PRIVATE",
      kind: "index_inspection",
      source: "search_console",
      OR: [...candidates.values()].map(({ result }) => ({
        artifactHash: result.receiptHash,
        sourceTaskId: result.taskId,
      })),
    },
    select: {
      artifactHash: true,
      sourceKey: true,
      pageIds: true,
      scopeVersion: true,
      payload: true,
    },
  });
  const projections = new Map<string, ProjectSeoObservation>();
  for (const stored of receipts) {
    const candidate = candidates.get(stored.artifactHash);
    const parsed = storedReceiptSchema.safeParse(stored.payload);
    if (!candidate || !parsed.success) continue;
    const { row, result } = candidate;
    const { receipt, contextFingerprint } = parsed.data;
    const parent = result.auditPageUrl ?? receipt.pages[0]?.pageUrl;
    if (
      !parent ||
      stored.sourceKey !==
        `task-indexing:${result.taskId}:${contextFingerprint}` ||
      (receipt.auditPageUrl ?? receipt.pages[0]?.pageUrl) !== parent ||
      stored.scopeVersion !== row.scopeVersion ||
      stored.pageIds.length !== row.pageIds.length ||
      !row.pageIds.every((id) => stored.pageIds.includes(id)) ||
      !hasSavedSeoIndexingAssessment(row, receipt, actor.userId, parent)
    )
      continue;
    const assessments = result.assessments.map((page) => {
      const inspected = receipt.pages.find(
        (entry) => entry.pageUrl === page.pageUrl,
      );
      if (
        page.status === "unavailable" &&
        !page.googleReturnedUnknown &&
        inspected &&
        (page.checkedAt ?? result.checkedAt) ===
          (parsed.data.reusedCheckedAt?.[page.pageUrl] ?? receipt.checkedAt) &&
        googleReturnedUnknown(parsed.data, inspected)
      )
        return { ...page, googleReturnedUnknown: true as const };
      return page;
    });
    // These are detached view rows. Storage and the original result hash remain immutable.
    projections.set(row.id, { ...row, payload: { ...result, assessments } });
  }
  return rows.map((row) => projections.get(row.id) ?? row);
}
