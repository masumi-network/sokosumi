import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import {
  SEO_MAX_PAGES,
  SEO_SEARCH_QUERY_ROW_LIMIT,
  seoDateSchema,
  seoIndexedPageSchema,
  seoKeywordSeriesSchema,
  seoPreviousPeriodSchema,
  seoSearchQueryRowSchema,
  seoUrlSchema,
} from "./project-seo.schema";
import {
  seoLandingPagesSchema,
  seoPositionedSearchBreakdownSchema,
  seoSearchBreakdownSchema,
  seoSearchTypeSchema,
  seoTrafficChannelSchema,
} from "./project-seo-traffic.schema";

/** Native metrics are owner-only, never part of a public Coworker result. */
export const nativeSeoMetricsSchema = z
  .object({
    provider: z.enum(["ga4", "search_console"]),
    propertyId: z.string().min(1).max(500),
    pageUrls: z.array(seoUrlSchema).min(1).max(SEO_MAX_PAGES),
    channel: seoTrafficChannelSchema,
    /** Search Console search type. Absent on web search reads and on older observations. */
    searchType: seoSearchTypeSchema.optional(),
    from: seoDateSchema,
    to: seoDateSchema,
    timeZone: z.string().min(1).max(100),
    observedAt: dateTimeSchema,
    coverage: z.enum(["complete", "partial", "unavailable"]),
    notes: z.array(z.string().max(2000)).max(50),
    metrics: z
      .array(
        z.object({
          key: z.string().min(1).max(100),
          label: z.string().min(1).max(200),
          unit: z.enum(["count", "ratio", "seconds", "position"]),
          value: z.number().finite().nullable(),
          points: z
            .array(
              z.object({
                date: seoDateSchema,
                value: z.number().finite().nullable(),
              }),
            )
            .max(400),
          previous: seoPreviousPeriodSchema.optional(),
        }),
      )
      .max(20),
    /** Search Console query/page rows for the same pages and period. Absent on older observations. */
    queries: z
      .object({
        rowLimit: z.number().int().positive().max(SEO_SEARCH_QUERY_ROW_LIMIT),
        truncated: z.boolean(),
        rows: z.array(seoSearchQueryRowSchema).max(SEO_SEARCH_QUERY_ROW_LIMIT),
      })
      .strict()
      .optional(),
    /** Daily positions of tracked keywords for the same pages and period. Absent when none were requested. */
    keywordSeries: seoKeywordSeriesSchema.optional(),
    /** Search Console totals by country and by device. Absent when the read failed or on Discover and Google News. */
    countries: seoPositionedSearchBreakdownSchema.optional(),
    devices: seoPositionedSearchBreakdownSchema.optional(),
    /**
     * The same split for Discover and Google News, where a row can come without a position.
     * Kept apart so that a build from before these types skips the sync as unknown keys
     * instead of failing the Traffic view on a null position.
     */
    feedCountries: seoSearchBreakdownSchema.optional(),
    feedDevices: seoSearchBreakdownSchema.optional(),
    /** Google Analytics organic key events per selected landing page. Absent when the read failed or on older observations. */
    landingPages: seoLandingPagesSchema.optional(),
    /** URL Inspection results for the selected pages Google answered for. Absent when none answered. */
    indexedPages: z.array(seoIndexedPageSchema).max(SEO_MAX_PAGES).optional(),
  })
  .strict()
  .refine((input) => input.from <= input.to, "Period ends before it starts")
  .openapi("NativeSeoMetrics");

export type NativeSeoMetrics = z.infer<typeof nativeSeoMetricsSchema>;
