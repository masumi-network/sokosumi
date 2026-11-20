import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { SEO_MAX_PAGES, seoUrlSchema } from "./seo-page.schema";

export const SEO_DECLINE_DATES = 3;
export const SEO_DECLINE_DONOR_LIMIT = 3;
export const SEO_SITE_HISTORY_LIMIT = 20;
export const SEO_MAX_DEFERRED_LEADS = 20;
const discoveryCoverageSchema = z.strictObject({
  discovered: z.number().int().nonnegative(),
  deferredCount: z.number().int().nonnegative(),
  deferred: z
    .array(
      z.strictObject({
        url: seoUrlSchema,
        reason: z.enum([
          "page_limit",
          "read_limit",
          "deadline",
          "robots",
          "access_limit",
          "unavailable",
        ]),
      }),
    )
    .max(SEO_MAX_DEFERRED_LEADS),
});
const urls = z.array(seoUrlSchema).max(SEO_MAX_PAGES);
const suppliedSitemap = z.enum(["read", "blocked", "unavailable"]).optional();
export const seoSiteEvidenceSchema = z.strictObject({
  version: z.literal(1),
  complete: z.boolean(),
  suppliedSitemap,
  coverage: discoveryCoverageSchema.optional(),
  sampledPages: urls,
  observations: z
    .array(
      z.strictObject({
        sourceUrl: seoUrlSchema,
        targetUrl: seoUrlSchema,
        sourceKind: z.enum(["link", "sitemap"]),
        location: z.enum(["content", "template", "body", "sitemap"]),
      }),
    )
    .max(SEO_MAX_PAGES * SEO_MAX_PAGES),
  responses: z
    .array(
      z.strictObject({
        pageUrl: seoUrlSchema,
        status: z.number().int().min(100).max(599),
        finalUrl: seoUrlSchema.optional(),
        declaredCanonical: seoUrlSchema.optional(),
        sitemapEligible: z.literal(true).optional(),
      }),
    )
    .max(SEO_MAX_PAGES)
    .optional(),
});
export type SeoSiteEvidence = z.infer<typeof seoSiteEvidenceSchema>;

export const storedSiteEvidenceSchema = z.strictObject({
  continuationScope: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  auditPageUrl: seoUrlSchema,
  targetUrls: urls,
  evidence: seoSiteEvidenceSchema,
});

const workspaceSiteEvidenceSchema = z
  .strictObject({
    taskId: z.string(),
    auditPageUrl: seoUrlSchema,
    observedAt: dateTimeSchema,
    sampledPages: urls,
    complete: z.boolean(),
    suppliedSitemap,
    coverage: discoveryCoverageSchema.optional(),
    targets: z
      .array(
        z.strictObject({
          targetUrl: seoUrlSchema,
          donorUrls: urls,
          contentDonorUrls: urls,
          sitemapUrls: z.array(seoUrlSchema).max(SEO_MAX_PAGES * SEO_MAX_PAGES),
          status: z.enum([
            "fix_link",
            "review_redirect",
            "strengthen_links",
            "review",
            "observed",
          ]),
          action: z.string(),
          httpStatus: z.number().int().optional(),
          sitemapEligible: z.literal(true).optional(),
          finalUrl: seoUrlSchema.optional(),
          declaredCanonical: seoUrlSchema.optional(),
          googleReferringPages: urls.optional(),
          googleSitemapUrls: urls.optional(),
          googleReason: z.string().optional(),
          googleCheckedAt: dateTimeSchema.optional(),
          trend: z
            .strictObject({
              previousAt: dateTimeSchema,
              previousCount: z.number().int(),
              currentCount: z.number().int(),
              decline: z
                .strictObject({
                  points: z
                    .array(
                      z.strictObject({
                        at: dateTimeSchema,
                        count: z.number().int().nonnegative(),
                      }),
                    )
                    .length(SEO_DECLINE_DATES),
                  missingDonorUrls: z
                    .array(seoUrlSchema)
                    .min(1)
                    .max(SEO_DECLINE_DONOR_LIMIT),
                })
                .optional(),
            })
            .optional(),
        }),
      )
      .max(SEO_MAX_PAGES),
  })
  .openapi("ProjectSeoSiteEvidence");

export const workspaceSiteEvidenceFields = {
  siteEvidence: z.union([workspaceSiteEvidenceSchema, z.null()]).optional(),
  auditSiteEvidence: z
    .array(workspaceSiteEvidenceSchema)
    .max(SEO_SITE_HISTORY_LIMIT)
    .optional(),
};
