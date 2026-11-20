import { z } from "@hono/zod-openapi";
import { SEO_STATS_MAX_DAYS } from "@/lib/seo/native-statistics";
import { seoDateSchema } from "./project-seo.schema";
import { seoSearchTypeSchema } from "./project-seo-traffic.schema";
import { SEO_MAX_PAGES, seoIdSchema, seoUrlSchema } from "./seo-page.schema";

export const siteTrafficInput = z
  .object({
    propertyId: z.string().min(1).max(500),
    scope: z.enum(["site", "selected"]),
    pageIds: z.array(seoIdSchema).min(1).max(SEO_MAX_PAGES),
    from: seoDateSchema,
    to: seoDateSchema,
    searchType: seoSearchTypeSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.from <= value.to &&
      Date.parse(value.to) - Date.parse(value.from) <
        SEO_STATS_MAX_DAYS * 86400000,
    "Invalid reporting period",
  )
  .openapi("SeoSiteTrafficInput");
const counts = z.object({
  clicks: z.number().int().nonnegative(),
  impressions: z.number().int().nonnegative(),
});
const urlRow = counts.extend({ url: seoUrlSchema });
export const siteTrafficReport = z
  .object({
    site: z.string(),
    propertyId: z.string(),
    from: seoDateSchema,
    to: seoDateSchema,
    totals: counts.nullable(),
    limited: z.boolean(),
    pages: z.array(
      counts.extend({
        url: seoUrlSchema,
        submitted: z.array(seoUrlSchema),
        variants: z.array(urlRow),
      }),
    ),
  })
  .openapi("SeoSiteTrafficReport");
export type SiteTrafficInput = z.infer<typeof siteTrafficInput>;

export type SiteTrafficReport = z.infer<typeof siteTrafficReport>;
