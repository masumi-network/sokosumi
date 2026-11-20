import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { seoIdSchema, seoUrlSchema } from "./seo-page.schema";

export const seoDeviceSchema = z.enum(["mobile", "desktop"]);

const researchStage = z.object({
  name: z.enum(["seasonal", "editorial", "exploration"]),
  status: z.enum(["completed", "partial", "skipped", "no_finding", "unknown"]),
  reason: z.string().max(400).optional(),
});

export const seoResearchCoverage = z.object({
  pageUrl: seoUrlSchema,
  scope: z.enum(["page", "site"]),
  rankedKeywordIdeas: z.boolean().optional(),
  stages: z.array(researchStage).max(3),
});
export type ResearchCoverage = z.infer<typeof seoResearchCoverage>;

export const seoChecklistBreakdown = z.object({
  passed: z.number().int().nonnegative().nullable(),
  flagged: z.number().int().nonnegative().nullable(),
  gaps: z.array(
    z.object({
      rowId: z.string(),
      pageUrl: seoUrlSchema,
      device: seoDeviceSchema,
      reason: z.string().max(1200),
    }),
  ),
  research: z.array(seoResearchCoverage),
});

export const seoModuleCoverageSchema = z.object({
  notRequested: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  notRequestedNames: z.array(z.string().max(20_000)).optional(),
  failedNames: z.array(z.string().max(20_000)).optional(),
});
export const seoObservationSchema = z
  .object({
    id: seoIdSchema,
    kind: z.string(),
    source: z.string(),
    observedAt: dateTimeSchema,
    pageIds: z.array(seoIdSchema),
    scopeVersion: z.number().int(),
    sourceTaskId: z.string().nullable(),
    countryCode: z.string().nullable(),
    languageCode: z.string().nullable(),
    devices: z.array(seoDeviceSchema),
    rulebookVersion: z.string(),
    artifactHash: z.string(),
    /** Critical, major and minor findings this run saved for the selected pages. */
    issues: z.number().int().nonnegative(),
    checklistBreakdown: seoChecklistBreakdown.optional(),
    coverage: z.object({
      checked: z.number().int(),
      skipped: z.number().int(),
      failed: z.number().int(),
      modules: seoModuleCoverageSchema.optional(),
    }),
  })
  .openapi("ProjectSeoObservation");
