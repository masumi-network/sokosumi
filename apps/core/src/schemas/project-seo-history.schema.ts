import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { seoRunDiffSchema } from "./project-seo-run-diff.schema";
import { seoAnalysisOutputKindSchema } from "./seo-analysis-enums.schema";
import { seoIdSchema } from "./seo-page.schema";

export const seoTimelineSchema = z
  .object({
    id: z.string(),
    kind: z.enum([
      "audit",
      "check",
      "metrics",
      "action",
      "scope",
      "page_change",
    ]),
    title: z.string(),
    at: dateTimeSchema,
    pageIds: z.array(seoIdSchema),
    observationId: z.union([seoIdSchema, z.null()]),
    taskId: z.string().nullable(),
    status: z.string(),
    detail: z.string(),
  })
  .openapi("ProjectSeoTimelineItem");
export const seoRunSchema = z
  .object({
    observationId: seoIdSchema,
    kind: z.string(),
    observedAt: dateTimeSchema,
    /** Critical, major and minor findings on the selected pages. Null where the run read only some of them. */
    issues: z.union([z.number().int().nonnegative(), z.null()]),
    /** Seconds from the request to the saved result. Null where no request of this workspace started the run. */
    seconds: z.union([z.number().int().nonnegative(), z.null()]),
    /** The SEO monitor whose scheduled Run made this result. Null for a one-off check. */
    monitorId: z.union([seoIdSchema, z.null()]).optional(),
    /** What this check changed against the earlier comparable check. Absent for the first check of its kind. */
    runDiff: seoRunDiffSchema.optional(),
  })
  .openapi("ProjectSeoRun");
export const seoJobSchema = z
  .object({
    id: seoIdSchema,
    kind: seoAnalysisOutputKindSchema,
    status: z.enum(["requested", "running", "completed", "failed"]),
    taskId: z.string().nullable(),
    pageIds: z.array(seoIdSchema),
    scopeVersion: z.number().int(),
    createdAt: dateTimeSchema,
  })
  .openapi("ProjectSeoAnalysis");
