import { z } from "@hono/zod-openapi";
import type { ProjectSeoObservation } from "@sokosumi/database";
import {
  type SeoTaskIndexingReceipt,
  seoAnsweredUnknownPageUrlsSchema,
  seoReusedInspectionTimesSchema,
  seoTaskIndexingReceiptSchema,
  seoTaskIndexingResultSchema,
} from "@/schemas/seo-task-indexing.schema";
import { sha256 } from "./project-seo-store";

export const persistedReceiptSchema = seoTaskIndexingReceiptSchema.omit({
  assessmentSaved: true,
});
export const storedReceiptSchema = z.strictObject({
  contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  propertyId: z.string().max(500).nullable(),
  providerAnsweredAll: z.literal(true).optional(),
  answeredUnknownPageUrls: seoAnsweredUnknownPageUrlsSchema.optional(),
  reusedCheckedAt: seoReusedInspectionTimesSchema.optional(),
  retainedAssessments: seoTaskIndexingResultSchema.shape.assessments.optional(),
  receipt: persistedReceiptSchema,
});
export type StoredReceipt = z.infer<typeof storedReceiptSchema>;

/** A lost result response can retry without repeating mutable public-page reads. */
export function hasSavedSeoIndexingAssessment(
  saved: Pick<
    ProjectSeoObservation,
    | "ownerId"
    | "visibility"
    | "kind"
    | "source"
    | "sourceTaskId"
    | "artifactHash"
    | "payload"
  > | null,
  receipt: SeoTaskIndexingReceipt,
  ownerId: string,
  auditPageUrl: string,
): boolean {
  if (
    !saved ||
    saved.ownerId !== ownerId ||
    saved.visibility !== "PRIVATE" ||
    saved.kind !== "index_triage" ||
    saved.source !== "seo_worker" ||
    saved.sourceTaskId !== receipt.taskId
  )
    return false;
  const parsed = seoTaskIndexingResultSchema.safeParse(saved.payload);
  if (!parsed.success) return false;
  const result = parsed.data;
  return (
    result.taskId === receipt.taskId &&
    result.receiptHash === receipt.receiptHash &&
    result.checkedAt === receipt.checkedAt &&
    (receipt.auditPageUrl === undefined ||
      receipt.auditPageUrl === auditPageUrl) &&
    (result.auditPageUrl === undefined ||
      result.auditPageUrl === auditPageUrl) &&
    saved.artifactHash === sha256(JSON.stringify(result)) &&
    result.assessments.length === receipt.pages.length &&
    new Set(result.assessments.map((page) => page.pageUrl)).size ===
      receipt.pages.length &&
    result.assessments.every((assessment) => {
      const page = receipt.pages.find(
        (entry) => entry.pageUrl === assessment.pageUrl,
      );
      return (
        page &&
        (page.verdict !== "VERDICT_UNSPECIFIED" ||
          assessment.status === "unavailable")
      );
    })
  );
}
