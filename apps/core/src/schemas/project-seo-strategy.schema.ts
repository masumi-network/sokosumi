import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

const text = z.string().max(20_000);
const label = z.string().max(100);
const url = z.string().max(4096);
const count = z.number().finite().nullable();

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
