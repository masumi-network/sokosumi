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
