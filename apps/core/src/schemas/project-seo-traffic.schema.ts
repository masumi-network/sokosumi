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

/** Discover and Google News show pages in a feed, with no search query: they have no query rows. */
export function seoSearchTypeHasQueries(type: SeoSearchType = "web"): boolean {
  return type !== "discover" && type !== "googleNews";
}

/** At most one landing row per selected page; equal to the page limit of a sync. */
const SEO_LANDING_PAGE_ROW_LIMIT = 10;
const landingCount = z.number().finite().nonnegative();
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
