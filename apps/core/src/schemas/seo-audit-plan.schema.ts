import { z } from "@hono/zod-openapi";
import { seoUrlSchema } from "./seo-page.schema";

/** The limits sit a little above the SEO worker's own, so a small change there does not drop a plan here. */
export const SEO_AUDIT_PLAN_LIMITS = {
  summary: 900,
  strategy: 500,
  action: 200,
  why: 700,
  order: 400,
  nextCheck: 400,
  option: 300,
  revisit: 500,
  phrase: 200,
  wording: 300,
  source: 200,
  queries: 8,
  ideas: 4,
  steps: 7,
} as const;
const limits = SEO_AUDIT_PLAN_LIMITS;
const words = (max: number) => z.string().min(1).max(max);

export const seoAuditPlanKinds = [
  "access",
  "fix",
  "content",
  "links",
  "offsite",
  "measure",
] as const;

/** A target month, as YYYY-MM. */
export const seoAuditPlanMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const seoAuditPlanStepSchema = z.object({
  /** Absent for a step that is not about one audited page. */
  pageUrl: seoUrlSchema.optional(),
  kind: z.enum(seoAuditPlanKinds).optional(),
  action: words(limits.action),
  why: words(limits.why),
  nextCheck: words(limits.nextCheck),
  /** Why the step stands at this position of the plan. */
  order: words(limits.order).optional(),
  queries: z.array(words(limits.phrase)).max(limits.queries).optional(),
  ideas: z.array(words(limits.phrase)).max(limits.ideas).optional(),
  wording: words(limits.wording).optional(),
  window: seoAuditPlanMonth.optional(),
  /** The report's own actions this step stands for, as the report's action ids. Empty when none matches. */
  actionIds: z.array(z.string().max(200)).max(3),
});

/** The plan the SEO worker wrote for one audit: every text is the worker's own English text. */
export const seoAuditPlanSchema = z
  .object({
    summary: words(limits.summary).optional(),
    strategy: words(limits.strategy).optional(),
    steps: z.array(seoAuditPlanStepSchema).min(1).max(limits.steps),
    alternative: z
      .object({ option: words(limits.option), whyNot: words(limits.option) })
      .optional(),
    revisit: words(limits.revisit).optional(),
    /** "evidence" for a plan the worker's code built; else the id of the model that wrote it. */
    source: z.string().max(limits.source).optional(),
  })
  .openapi("SeoAuditPlan");
export type SeoAuditPlan = z.infer<typeof seoAuditPlanSchema>;
