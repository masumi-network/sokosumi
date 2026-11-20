import { z } from "@hono/zod-openapi";
import { seoActionSchema } from "./project-seo-action.schema";
import {
  seoPositionedSearchBreakdownSchema,
  seoSearchQueryRowSchema,
} from "./project-seo-traffic.schema";
import { SEO_MAX_PAGES, seoUrlSchema } from "./seo-page.schema";

import {
  auditDiscoverySchema,
  sitemapAddress,
} from "./seo-sitemap-evidence.schema";

export const AUDIT_PERFORMANCE_KIND = "audit_search_performance";
export const AUDIT_QUERY_PREVIEW_LIMIT = 10;
export const auditMeasuredPageSchema = z.object({
  pageUrl: seoUrlSchema,
  measuredUrl: seoUrlSchema,
  basis: z.enum(["selected", "google_canonical", "unverified"]),
});
const totals = z.object({
  clicks: z.number().nullable(),
  impressions: z.number().nullable(),
  ctr: z.number().nullable(),
  averagePosition: z.number().nullable(),
});
const periodTotals = totals.extend({ from: z.iso.date(), to: z.iso.date() });
export const auditClickHistorySchema = z.object({
  reason: z.enum(["recent_click_decline", "recent_click_growth"]),
  from: z.iso.date(),
  to: z.iso.date(),
  coverage: z.enum(["complete", "partial", "unavailable"]),
  clicks: z.number().int().nonnegative().nullable(),
  decision: z.enum([
    "investigate_loss",
    "investigate_growth",
    "monitor",
    "insufficient_history",
  ]),
});
export type AuditClickHistory = z.infer<typeof auditClickHistorySchema>;
export const seoAuditPerformanceSchema = periodTotals.extend({
  taskId: z.string(),
  propertyId: z.string(),
  pageUrls: z.array(seoUrlSchema).max(SEO_MAX_PAGES),
  measuredPages: z.array(auditMeasuredPageSchema).max(SEO_MAX_PAGES),
  coverage: z.enum(["complete", "partial", "unavailable"]),
  opportunities: z.array(
    seoActionSchema.pick({
      id: true,
      title: true,
      why: true,
      pageUrl: true,
      expectedEffect: true,
      evidence: true,
    }),
  ),
  previous: periodTotals.nullable(),
  history: auditClickHistorySchema.optional(),
  discovery: auditDiscoverySchema
    .extend({
      publicSitemaps: z.array(sitemapAddress).max(3),
      actions: z
        .array(
          z.object({
            url: sitemapAddress,
            action: z.string(),
            evidence: z.string(),
          }),
        )
        .max(63),
    })
    .optional(),
  countries: seoPositionedSearchBreakdownSchema.optional(),
  queries: z
    .object({
      rows: z.array(seoSearchQueryRowSchema).max(AUDIT_QUERY_PREVIEW_LIMIT),
      truncated: z.boolean(),
    })
    .nullable(),
});
