import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { seoAuditPlanSchema } from "./seo-audit-plan.schema";
import { seoIdSchema, seoUrlSchema } from "./seo-page.schema";
import { seoPageSpeed } from "./seo-page-speed.schema";
import {
  seoReportPlanCandidate,
  seoReportPlanSignal,
} from "./seo-report-plan.schema";

import {
  seoFirstScreen,
  seoKeywordTrends,
} from "./seo-research-details.schema";

export const seoDeviceSchema = z.enum(["mobile", "desktop"]);
/** The worker's hash of a row's rule: equal keys mean the same rule and check across rulebook versions. */
export const seoRuleKeySchema = z.string().regex(/^[0-9a-f]{16}$/);

export const storedSeoChecklist = z
  .array(
    z.object({
      rowId: z.string().max(20_000),
      reason: z.string().max(1200).optional(),
      pageUrl: seoUrlSchema,
      device: seoDeviceSchema,
      result: z.enum(["pass", "fired", "blocked", "not_checked"]),
      ruleKey: seoRuleKeySchema.optional(),
      // The result rests only on the page's own raw read, so a later pass can be the owner's fix.
      pageOnly: z.literal(true).optional(),
      // The address the row's device read in the end.
      finalUrl: seoUrlSchema.optional(),
    }),
  )
  .max(10000);

const researchStage = z.object({
  name: z.enum(["seasonal", "editorial", "exploration"]),
  status: z.enum(["completed", "partial", "skipped", "no_finding", "unknown"]),
  reason: z
    .string()
    .max(400)
    .overwrite((text) => {
      if (text === "The remaining data budget could not cover validation.")
        return "The remaining budget could not cover another keyword check.";
      if (
        text ===
        "The exploration found no new recommendation with enough evidence."
      )
        return "The audit found no new recommendation.";
      return text;
    })
    .optional(),
});

export const seoResearchCoverage = z.object({
  pageUrl: seoUrlSchema,
  scope: z.enum(["page", "site"]),
  firstScreen: seoFirstScreen.optional(),
  trends: seoKeywordTrends.optional(),
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

/** Only regional versions verified from the standalone page's public capture. */
export const seoPageMarketEvidence = z.object({
  regionalVersions: z
    .array(
      z.object({
        country: z.string().regex(/^[A-Z]{2}$/),
        language: z.string().regex(/^[a-z]{2}$/),
        url: seoUrlSchema,
      }),
    )
    .max(20),
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
    planCandidates: z.array(seoReportPlanCandidate).optional(),
    planSignals: z.array(seoReportPlanSignal).optional(),
    /** The SEO worker's plan for this audit, when the view holds every page it names. */
    auditPlan: seoAuditPlanSchema.optional(),
    checklistBreakdown: seoChecklistBreakdown.optional(),
    pageSpeed: seoPageSpeed.optional(),
    pageSpeedRecoveryFileId: seoIdSchema.optional(),
    pageMarketEvidence: seoPageMarketEvidence.optional(),
    coverage: z.object({
      checked: z.number().int(),
      skipped: z.number().int(),
      failed: z.number().int(),
      modules: seoModuleCoverageSchema.optional(),
    }),
  })
  .openapi("ProjectSeoObservation");
