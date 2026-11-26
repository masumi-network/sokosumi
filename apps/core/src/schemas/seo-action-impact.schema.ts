import { z } from "@hono/zod-openapi";
import {
  SEO_IMPACT_MAX_WINDOW_DAYS,
  SEO_IMPACT_MIN_WINDOW_DAYS,
} from "@sokosumi/utils";
import { SEO_MAX_PAGES, seoUrlSchema } from "./seo-page.schema";

/** A calendar day as Search Console dates it. A plain string, so no client turns it into an instant with a time zone. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const AUDIT_PAGE_SERIES_KIND = "audit_page_search_series";
export const auditPageSeriesKey = (taskId: string) =>
  `audit-page-series:${taskId}`;

/** Daily Search Console rows of each audit page alone. A page whose read failed is absent, not empty. */
export const auditPageSeriesSchema = z.object({
  propertyId: z.string(),
  from: day,
  to: day,
  pages: z
    .array(
      z.object({
        pageUrl: seoUrlSchema,
        measuredUrl: seoUrlSchema,
        days: z.array(
          z.object({
            date: day,
            clicks: z.number(),
            impressions: z.number(),
            position: z.number().nullable(),
          }),
        ),
      }),
    )
    .max(SEO_MAX_PAGES),
});
export type AuditPageSeries = z.infer<typeof auditPageSeriesSchema>;

const impactTotals = z.object({
  from: day,
  to: day,
  clicks: z.number(),
  impressions: z.number(),
  position: z.number().nullable(),
});
/** Search Console totals of the action's page alone, before and after the action was done. */
export const seoActionImpactSchema = z
  .object({
    /** The day the action counts as done, in Search Console's Pacific calendar. Neither window includes it. */
    anchor: day,
    anchorKind: z.enum(["completed", "verified"]),
    days: z.number().int().positive(),
    state: z.enum(["measured", "too_early", "not_measured", "low_counts"]),
    before: z.union([impactTotals, z.null()]),
    after: z.union([impactTotals, z.null()]),
  })
  .openapi("ProjectSeoActionImpact");

/** The window length a caller chooses. Absent means the default of the SEO tab. */
export const seoImpactDaysSchema = z.coerce
  .number()
  .int()
  .min(SEO_IMPACT_MIN_WINDOW_DAYS)
  .max(SEO_IMPACT_MAX_WINDOW_DAYS)
  .optional();

/** The done actions on the audit's own pages, for the worker of that audit. */
const measuredActions = z.array(
  z.strictObject({
    id: z.string(),
    pageUrl: seoUrlSchema,
    title: z.string(),
    impact: seoActionImpactSchema,
  }),
);
export const seoTaskActionImpactSchema = z
  .strictObject({ actions: measuredActions })
  .openapi("SeoTaskActionImpact");
export type SeoTaskActionImpact = z.infer<typeof seoTaskActionImpactSchema>;

export const ADMIN_SEO_IMPACT_PAGE_SIZE = 10;
export const adminSeoActionImpactQuery = z.object({
  days: seoImpactDaysSchema,
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
});
/** Staff only. One item per audit or Project and the person whose Search Console rows it holds. */
export const adminSeoActionImpactSchema = z
  .strictObject({
    total: z.number().int().nonnegative(),
    pageSize: z.number().int().positive(),
    items: z.array(
      z.strictObject({
        auditId: z.uuid().nullable(),
        projectId: z.uuid().nullable(),
        workspaceId: z.uuid(),
        workspaceOrganizationSlug: z.string().nullable(),
        workspaceUserId: z.string().nullable(),
        userId: z.string(),
        actions: measuredActions,
      }),
    ),
  })
  .openapi("AdminSeoActionImpact");
export type AdminSeoActionImpact = z.infer<typeof adminSeoActionImpactSchema>;
