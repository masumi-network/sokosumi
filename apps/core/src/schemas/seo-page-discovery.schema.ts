import { z } from "@hono/zod-openapi";
import { seoSearchQueryRowSchema } from "./project-seo-traffic.schema";
import { seoUrlSchema } from "./seo-page.schema";

export const MAX_DISCOVERED_PAGES = 5;
export const MAX_TOP_CLICKED_PAGES = 5;
const counts = z.object({
  clicks: z.number().int().nonnegative(),
  impressions: z.number().int().nonnegative(),
});
const period = z.object({ from: z.iso.date(), to: z.iso.date() });
export const seoPageDiscoverySchema = z.object({
  recent: period,
  previous: period,
  limited: z.boolean(),
  comparisonIncomplete: z.literal(true).optional(),
  topClickedPages: z
    .array(counts.extend({ pageUrl: seoUrlSchema }))
    .max(MAX_TOP_CLICKED_PAGES)
    .optional(),
  pages: z
    .array(
      z.object({
        pageUrl: seoUrlSchema,
        reason: z.enum(["lostClicks", "gainingImpressions", "lowCtr"]),
        totals: counts,
        recent: counts,
        previous: counts,
        query: seoSearchQueryRowSchema.nullable(),
        queryUnavailable: z.literal(true).optional(),
        expectedEffect: z.string().max(2500).optional(),
        suggestion: z.string().max(2500).nullable(),
      }),
    )
    .max(MAX_DISCOVERED_PAGES),
});
export type SeoPageDiscovery = z.infer<typeof seoPageDiscoverySchema>;

export function auditPageDiscoveryComplete(discovery?: SeoPageDiscovery) {
  return Boolean(
    discovery?.topClickedPages &&
      !discovery.comparisonIncomplete &&
      !discovery.pages.some((page) => page.queryUnavailable),
  );
}
