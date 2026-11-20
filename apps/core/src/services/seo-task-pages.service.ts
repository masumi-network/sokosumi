import { z } from "zod";
import { conflict } from "@/helpers/error";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  originalSeoAuditPacket,
  publicSeoRedirectOrigin,
  selectSeoRelatedPages,
  validateSeoSiteEvidence,
} from "@/lib/seo/related-page-selection";
import type { AuthenticationContext } from "@/middleware/auth";
import { storedSeoFullAuditPriceSchema } from "@/schemas/seo-audit-price.schema";
import {
  type SeoTaskRelatedPagesRequest,
  seoRelatedIndexingSelectionSchema,
} from "@/schemas/seo-task-pages.schema";
import { seoOwnerData, sha256 } from "./project-seo-store";
import { seoAuditInspectionPages } from "./seo-audit-related-pages";
import { requireSeoTaskAuditContext } from "./seo-task-audit-context";

const indexingRequest = z.object({
  inspectRelated: z.literal(true),
  price: storedSeoFullAuditPriceSchema,
  pageUrls: z.array(z.string()),
});

/** Freeze only the private inspection targets. The original audit page IDs, URLs and price never change. */
export function freezeSeoTaskRelatedIndexing(
  auth: AuthenticationContext,
  taskId: string,
  input: SeoTaskRelatedPagesRequest,
) {
  return serializableTransaction(async (tx) => {
    const { actor, analysis, task, pageUrls } =
      await requireSeoTaskAuditContext(auth, taskId, input.expectedContext, tx);
    if (task.status !== "RUNNING")
      throw conflict("Related indexing checks require a running audit Task");
    const original = originalSeoAuditPacket(analysis.request);
    const packet = indexingRequest.safeParse(original);
    if (!packet.success)
      throw conflict("This audit did not approve related-page indexing checks");
    if (
      JSON.stringify(input.seedPageUrls) !==
      JSON.stringify(packet.data.pageUrls)
    )
      throw conflict("The approved audit seed pages or Task request changed");
    const stored = z
      .object({
        relatedIndexingSelection: seoRelatedIndexingSelectionSchema.optional(),
        searchConsoleAccess: z.json().optional(),
        fullAuditBillingContext: z.json().optional(),
        fullAuditCost: z.json().optional(),
        pendingFullAuditCost: z.json().optional(),
      })
      .parse(analysis.request);
    if (
      stored.fullAuditCost !== undefined ||
      stored.pendingFullAuditCost !== undefined
    )
      throw conflict("This completed audit already has a billing receipt");
    if (stored.relatedIndexingSelection)
      return {
        version: 1 as const,
        taskId,
        auditPageUrl: pageUrls[0]!,
        inspectionPageUrls: seoAuditInspectionPages(analysis.request, pageUrls),
      };
    const publicOrigin = publicSeoRedirectOrigin(
      pageUrls[0]!,
      input.siteEvidence,
      stored.searchConsoleAccess,
    );
    const publicTargets = selectSeoRelatedPages(
      input.seedPageUrls,
      input.relatedPageUrls,
      stored.searchConsoleAccess,
      publicOrigin,
    );
    const inspectionPageUrls = selectSeoRelatedPages(
      input.seedPageUrls,
      input.relatedPageUrls.filter(
        (url) => new URL(url).origin !== publicOrigin,
      ),
      stored.searchConsoleAccess,
    );
    if (
      await tx.projectSeoObservation.count({ where: { sourceTaskId: taskId } })
    )
      throw conflict(
        "An audit with saved evidence cannot change its indexing targets",
      );
    const relatedPageUrls = inspectionPageUrls.filter(
      (url) => !pageUrls.includes(url),
    );
    if (input.siteEvidence) {
      validateSeoSiteEvidence(
        input.siteEvidence,
        publicTargets,
        stored.searchConsoleAccess,
        publicOrigin,
      );
      const payload = {
        auditPageUrl: pageUrls[0]!,
        targetUrls: publicTargets,
        evidence: input.siteEvidence,
      };
      await tx.projectSeoObservation.create({
        data: {
          ...seoOwnerData(actor),
          sourceKey: `task-site-evidence:${taskId}`,
          source: "seo_worker",
          kind: "site_evidence",
          sourceTaskId: taskId,
          ownerId: actor.userId,
          visibility: "PRIVATE",
          pageIds: analysis.pageIds,
          scopeVersion: analysis.scopeVersion,
          artifactHash: sha256(JSON.stringify(payload)),
          observedAt: new Date(),
          payload,
        },
      });
    }
    await tx.projectSeoAnalysis.update({
      where: { id: analysis.id },
      data: {
        request: {
          ...original,
          ...(stored.fullAuditBillingContext !== undefined && {
            fullAuditBillingContext: stored.fullAuditBillingContext,
          }),
          ...(stored.searchConsoleAccess !== undefined && {
            searchConsoleAccess: stored.searchConsoleAccess,
          }),
          relatedIndexingSelection: {
            version: 1,
            seedPageUrls: pageUrls,
            relatedPageUrls,
          },
        },
      },
    });
    return {
      version: 1 as const,
      taskId,
      auditPageUrl: pageUrls[0]!,
      inspectionPageUrls,
    };
  }, "The audit indexing selection changed. Please retry.");
}
