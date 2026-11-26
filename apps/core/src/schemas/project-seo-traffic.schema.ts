import { z } from "@hono/zod-openapi";
import { SEO_SEARCH_TYPES, SEO_TRAFFIC_CHANNELS } from "@sokosumi/utils";
import { dateTimeSchema } from "@/helpers/datetime";
import { seoUrlSchema } from "./seo-page.schema";

/**
 * Which sessions a Google Analytics read counts: all, organic search, or the GA4
 * "AI Assistant" default channel group (ChatGPT, Gemini, Copilot and others).
 * Search Console reads are organic search only.
 */
export const seoTrafficChannelSchema = z.enum(SEO_TRAFFIC_CHANNELS);
export type SeoTrafficChannel = z.infer<typeof seoTrafficChannelSchema>;

/**
 * Search Console search types, as the Search Analytics `type` field names them.
 * `news` is the News tab of Google Search; `googleNews` is news.google.com and the Google News app.
 */
export const seoSearchTypeSchema = z.enum(SEO_SEARCH_TYPES);
export type SeoSearchType = z.infer<typeof seoSearchTypeSchema>;

export { seoSearchTypeHasQueries } from "@sokosumi/utils";

export const SEO_SEARCH_QUERY_ROW_LIMIT = 250;
/** One Search Console row grouped by query and page. Average position is not a live rank. */
export const seoSearchQueryRowSchema = z.object({
  query: z.string().min(1).max(2048),
  pageUrl: seoUrlSchema,
  clicks: z.number().finite().nonnegative(),
  impressions: z.number().finite().nonnegative(),
  ctr: z.number().finite().min(0).max(1),
  averagePosition: z.number().finite().min(1),
});

/** At most one landing row per selected page; equal to the page limit of a sync. */
const SEO_LANDING_PAGE_ROW_LIMIT = 10;
const landingCount = z.number().finite().nonnegative();
/** Rows of an AI Assistant read: one per page and assistant. */
export const SEO_AI_SOURCE_ROW_LIMIT = 250;
/** Google Analytics sessions and key events of one channel, for sessions that started on each selected page. */
export const seoLandingPagesSchema = z
  .object({
    channel: z.enum(["organic", "ai_assistant"]),
    /** Property host proved by a complete, unsampled host inventory for the same period. Absent on older reads. */
    verifiedHost: z.string().min(1).max(253).optional(),
    // The timezone of a complete landing report with views and engagement in the same population.
    timeZone: z.string().min(1).max(100).optional(),
    rows: z
      .array(
        z
          .object({
            pageUrl: z.string().url().max(2048),
            sessions: landingCount,
            keyEvents: landingCount,
            engagementSeconds: landingCount.optional(),
            views: landingCount.optional(),
          })
          .strict(),
      )
      .max(SEO_LANDING_PAGE_ROW_LIMIT),
    /** AI Assistant reads only: each assistant (GA4 session source) per page, most sessions first. */
    sources: z
      .array(
        z
          .object({
            pageUrl: z.string().url().max(2048),
            source: z.string().min(1).max(500),
            sessions: landingCount,
            keyEvents: landingCount,
          })
          .strict(),
      )
      .max(SEO_AI_SOURCE_ROW_LIMIT)
      .optional(),
    /** AI Assistant reads only: GA4 had more rows than the read kept, so page sums are a floor. */
    truncated: z.boolean().optional(),
    /** Selected pages left out of the read: another selected page on another host has the same path. */
    skippedUrls: z
      .array(z.string().url().max(2048))
      .max(SEO_LANDING_PAGE_ROW_LIMIT)
      .optional(),
  })
  .strict();
export type SeoLandingPages = z.infer<typeof seoLandingPagesSchema>;
/** The newest Google Analytics landing page read for the selected pages, with where it came from. */
export const seoWorkspaceLandingPagesSchema = seoLandingPagesSchema
  .extend({
    /** The pages the read asked for. One without a row had no session of the channel in the period. */
    // The stored read's own URL rule: a URL the read holds must not fail the workspace.
    pageUrls: z.array(seoUrlSchema),
    observationId: z.string().uuid(),
    propertyId: z.string(),
    from: z.string(),
    to: z.string(),
    observedAt: dateTimeSchema,
  })
  .openapi("ProjectSeoLandingPages");
/** The landing reads of a workspace: one per channel, so a newer read of one channel does not hide the other. */
export const workspaceLandingFields = {
  /** Organic key events per landing page from the newest organic Google Analytics sync in view. */
  landingPages: z.union([seoWorkspaceLandingPagesSchema, z.null()]).optional(),
  /** Visits from AI assistants per landing page from the newest AI Assistant sync in view. */
  aiAssistantPages: z
    .union([seoWorkspaceLandingPagesSchema, z.null()])
    .optional(),
};

/** Owner-chosen words that name the brand. Search Console queries that contain one count as branded. */
export const SEO_BRAND_TERM_LIMIT = 50;
const brandTermSchema = z.string().trim().min(1).max(100);
/** A term of signs only ("++", "&&") would read as no term at all, so a save refuses it. */
const savedBrandTermSchema = brandTermSchema.refine(
  (term) => /[\p{L}\p{N}]/u.test(term),
  "A brand term needs a letter or digit.",
);
export const saveSeoBrandTermsSchema = z
  .object({ terms: z.array(savedBrandTermSchema).max(SEO_BRAND_TERM_LIMIT) })
  .strict()
  .openapi("SaveProjectSeoBrandTermsRequest");
/** Stored as an observation of kind "settings". A changed list replaces the older rows, so one row is current. */
export const seoSettingsPayloadSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("settings"),
    brandTerms: z.array(brandTermSchema).max(SEO_BRAND_TERM_LIMIT),
    recordedBy: z.string().min(1).max(128),
  })
  .strict();
export const SEO_BREAKDOWN_ROW_LIMIT = 250;
const breakdownPosition = z.number().finite().min(1);
/**
 * Search Console totals for the same pages and period, grouped by one
 * dimension. A country key is ISO alpha-2, or Google's alpha-3 code when it
 * has no alpha-2 twin. A device key is desktop, mobile or tablet.
 */
function breakdownSchema<Position extends z.ZodTypeAny>(
  averagePosition: Position,
) {
  return z
    .object({
      rowLimit: z.number().int().positive().max(SEO_BREAKDOWN_ROW_LIMIT),
      truncated: z.boolean(),
      rows: z
        .array(
          z
            .object({
              key: z.string().regex(/^(?:[A-Z]{2,3}|desktop|mobile|tablet)$/),
              clicks: z.number().finite().nonnegative(),
              impressions: z.number().finite().nonnegative(),
              ctr: z.number().finite().min(0).max(1),
              averagePosition,
            })
            .strict(),
        )
        .max(SEO_BREAKDOWN_ROW_LIMIT),
    })
    .strict();
}
/**
 * A split of a search type with query rows: every row has a position. Builds
 * from before Discover and Google News read these rows and need the position.
 */
export const seoPositionedSearchBreakdownSchema =
  breakdownSchema(breakdownPosition);
export type SeoPositionedSearchBreakdown = z.infer<
  typeof seoPositionedSearchBreakdownSchema
>;
/** Any split. Null position: a Discover or Google News row came without one. */
export const seoSearchBreakdownSchema = breakdownSchema(
  breakdownPosition.nullable(),
).openapi("ProjectSeoSearchBreakdown");
export type SeoSearchBreakdown = z.infer<typeof seoSearchBreakdownSchema>;
/** The newest Search Console country and device split in view, with where it came from. */
export const seoWorkspaceSearchBreakdownSchema = z
  .object({
    observationId: z.string().uuid(),
    propertyId: z.string(),
    from: z.string(),
    to: z.string(),
    observedAt: dateTimeSchema,
    countries: seoSearchBreakdownSchema.optional(),
    devices: seoSearchBreakdownSchema.optional(),
  })
  .openapi("ProjectSeoWorkspaceSearchBreakdown");
