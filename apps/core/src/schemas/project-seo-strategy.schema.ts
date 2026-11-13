import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/** The longest text field of a stored strategy. */
export const SEO_STRATEGY_TEXT_MAX_LENGTH = 20_000;
const text = z.string().max(SEO_STRATEGY_TEXT_MAX_LENGTH);
const label = z.string().max(100);
const url = z.string().max(4096);
const count = z.number().finite().nullable();
/** The SEO bot writes at most 1500 characters. One character can be 2 UTF-16 units, which is what the check counts. */
export const SEO_STRATEGY_DRAFT_MAX_LENGTH = 3000;

/** The SEO bot's place notes are a few lines; more are cut at import. */
export const SEO_STRATEGY_PLACES_NOTES_MAX = 20;

/** The one place of a promotion action: where the owner posts or gets listed. */
export const seoStrategyPlaceSchema = z.object({
  name: text.min(1),
  url,
  form: label,
});

/** At most this many rows of a feature reach or article idea section; the SEO bot reads at most 10. */
export const SEO_KEYWORD_REACH_ROWS_MAX = 10;
/** At most this many competing products; the SEO bot reads at most 3. */
export const SEO_RIVAL_HOSTS_MAX = 3;
/** At most this many keyword rows per competing product; the SEO bot reads at most 100. */
export const SEO_RIVAL_ROWS_MAX = 100;

/** The reach of each feature's best search that no keyword group holds (SEO bot ticket 76). */
export const seoFeatureReachSchema = z
  .array(
    z.object({
      feature: text,
      keyword: text,
      /** Monthly searches in the suggestions read. */
      volume: z.number().finite(),
      /** Monthly searches in the overview read (the recent mean when the trend falls). */
      demand: count,
      reach: label,
      position: count,
      note: text.nullable(),
    }),
  )
  .max(SEO_KEYWORD_REACH_ROWS_MAX)
  .optional();
/** The organic keywords of each competing product, most searches first (SEO bot ticket 76). */
export const seoRivalKeywordsSchema = z
  .array(
    z.object({
      host: z.string().min(1).max(253),
      /** The keywords the host ranks for in the vendor's database; the rows are the first of them. */
      total: count,
      /** The site's topic words the rows were matched against; none when the site has too few keyword rows. */
      topicWords: z.array(label).max(50),
      rows: z
        .array(
          z.object({
            keyword: text,
            volume: count,
            position: count,
            url: url.nullable(),
            /** The keyword holds a topic word of the site. A host with other products ranks for their keywords too. */
            topic: z.boolean(),
          }),
        )
        .max(SEO_RIVAL_ROWS_MAX),
    }),
  )
  .max(SEO_RIVAL_HOSTS_MAX)
  .optional();
/** Searches the product's users make before they need it, as article ideas (SEO bot ticket 76). They convert low. */
export const seoArticleIdeasSchema = z
  .array(
    z.object({
      topic: text,
      feature: text,
      keyword: text.nullable(),
      demand: count,
      reach: label,
      position: count,
      note: text.nullable(),
      suggestions: z
        .array(z.object({ keyword: text, volume: z.number().finite() }))
        .max(SEO_KEYWORD_REACH_ROWS_MAX)
        .nullable(),
    }),
  )
  .max(SEO_KEYWORD_REACH_ROWS_MAX)
  .optional();
export type SeoKeywordReach = {
  featureReach?: z.infer<typeof seoFeatureReachSchema>;
  rivalKeywords?: z.infer<typeof seoRivalKeywordsSchema>;
  articleIdeas?: z.infer<typeof seoArticleIdeasSchema>;
};

/** The strategy results of a site audit that Core keeps. The helper checks each URL at import. */
export const seoStrategyPayloadSchema = z.object({
  verdict: label,
  why: text,
  groups: z
    .array(
      z.object({
        lead: text,
        keywords: z.array(text).max(100),
        pageUrl: url.nullable(),
        volume: count,
        recent: count,
        trend: z.enum(["falling", "rising", "flat"]).nullable(),
        reach: label,
        position: count,
      }),
    )
    .max(1000),
  actions: z
    .array(
      z.object({
        kind: label,
        title: text,
        why: text,
        expectedEffect: text,
        effort: z.enum(["low", "medium", "high"]),
        limit: text.nullable(),
        /** A promotion action names one place to post in or to get listed on. Older rows have none. */
        place: seoStrategyPlaceSchema.optional(),
        /** The text the audit wrote for the place, for the owner to read and post. */
        draft: z.string().max(SEO_STRATEGY_DRAFT_MAX_LENGTH).optional(),
        targets: z
          .array(
            z.object({
              url,
              title: text.nullable(),
              type: label,
              /** How many of the audit's SERP reads list the page. Older rows have none. */
              serps: z.number().int().nonnegative().nullable().optional(),
              state: label.nullable(),
            }),
          )
          .max(20),
      }),
    )
    .max(50),
  /**
   * Why a promotion place is missing or has no text: a community whose terms ban promotion, a place the audit's agent
   * left out or did not answer for. Older rows have none.
   */
  placesNotes: z.array(text).max(SEO_STRATEGY_PLACES_NOTES_MAX).optional(),
  /** The keyword reach sections of the site audit. Older rows have none. */
  featureReach: seoFeatureReachSchema,
  rivalKeywords: seoRivalKeywordsSchema,
  articleIdeas: seoArticleIdeasSchema,
});
export type SeoStrategyPayload = z.infer<typeof seoStrategyPayloadSchema>;

export const seoStrategySchema = seoStrategyPayloadSchema
  .extend({
    observationId: z.string().uuid(),
    observedAt: dateTimeSchema,
    /** The Market of the audit: its keyword numbers hold for this Market only. */
    countryCode: z.string().nullable(),
    languageCode: z.string().nullable(),
  })
  .openapi("ProjectSeoStrategy");
