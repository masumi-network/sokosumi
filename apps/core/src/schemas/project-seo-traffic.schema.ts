import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";

/**
 * Which sessions a Google Analytics read counts: all, organic search, or the GA4
 * "AI Assistant" default channel group (ChatGPT, Gemini, Copilot and others).
 * Search Console reads are organic search only.
 */
export const SEO_TRAFFIC_CHANNELS = ["all", "organic", "ai_assistant"] as const;
export const seoTrafficChannelSchema = z.enum(SEO_TRAFFIC_CHANNELS);
export type SeoTrafficChannel = z.infer<typeof seoTrafficChannelSchema>;

/**
 * Search Console search types, as the Search Analytics `type` field names them.
 * `news` is the News tab of Google Search; `googleNews` is news.google.com and the Google News app.
 */
export const SEO_SEARCH_TYPES = [
  "web",
  "image",
  "video",
  "news",
  "discover",
  "googleNews",
] as const;
export const seoSearchTypeSchema = z.enum(SEO_SEARCH_TYPES);
export type SeoSearchType = z.infer<typeof seoSearchTypeSchema>;

/**
 * Discover and Google News show pages in a feed, with no search query: they have no query rows.
 * INFERRED from the Search Console help, not the Search Analytics API page, which does not say
 * the query dimension is unsupported for these types.
 */
export function seoSearchTypeHasQueries(type: SeoSearchType = "web"): boolean {
  return type !== "discover" && type !== "googleNews";
}

/** At most one landing row per selected page; equal to the page limit of a sync. */
const SEO_LANDING_PAGE_ROW_LIMIT = 10;
const landingCount = z.number().finite().nonnegative();
/** Rows of an AI Assistant read: one per page and assistant. */
export const SEO_AI_SOURCE_ROW_LIMIT = 250;
/** Google Analytics sessions and key events of one channel, for sessions that started on each selected page. */
export const seoLandingPagesSchema = z
  .object({
    channel: z.enum(["organic", "ai_assistant"]),
    rows: z
      .array(
        z
          .object({
            pageUrl: z.string().url().max(2048),
            sessions: landingCount,
            keyEvents: landingCount,
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
    observationId: z.string().uuid(),
    propertyId: z.string(),
    from: z.string(),
    to: z.string(),
    observedAt: dateTimeSchema,
  })
  .openapi("ProjectSeoLandingPages");

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
/** Stored as an immutable observation of kind "settings"; the newest one is current. */
export const seoSettingsPayloadSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("settings"),
    brandTerms: z.array(brandTermSchema).max(SEO_BRAND_TERM_LIMIT),
    recordedBy: z.string().min(1).max(128),
  })
  .strict();
