import { z } from "@hono/zod-openapi";

const period = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
const day = z.iso.date();
const volume = z.number().int().nonnegative();
const month = z.object({ period, volume: volume.nullable() });
const chronological = (periods: string[]) =>
  periods.every((value, index) => index === 0 || periods[index - 1] < value);
/** DataForSEO keeps up to three years of monthly history for a query. */
export const MAX_SEASONAL_HISTORY_MONTHS = 36;

export const seoSeasonalIdeaSchema = z.object({
  origin: z.literal("market_history").optional(),
  keyword: z.string().min(2).max(80),
  audience: z.string().min(2).max(80),
  url: z.httpUrl(),
  asOf: day,
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[a-z]{2}$/),
  pageQuote: z.string().min(8).max(180),
  action: z.enum(["improve_existing_page", "investigate_angle"]),
  limitations: z
    .array(
      z.enum([
        "demand_unverified",
        "timing_uncertain",
        "audience_fit_uncertain",
        "offer_unverified",
        "existing_page_may_cover",
      ]),
    )
    .max(5),
  event: z
    .object({ name: z.string().max(80), scope: z.string().max(250), date: day })
    .nullable(),
  comparison: z
    .object({
      status: z.enum(["above_baseline", "no_observed_rise", "insufficient"]),
      leadMonth: month.nullable(),
      eventMonth: month.nullable(),
      baselineMedian: z.number().nonnegative().nullable(),
    })
    .nullable(),
  windows: z
    .array(
      z.object({
        targetPeriod: period,
        historicalPeriod: period,
        historicalVolume: volume,
        baselineMedian: z.number().nonnegative(),
        referenceMonths: z
          .array(period)
          .min(6)
          .max(8)
          .refine(
            chronological,
            "Reference months must be distinct and chronological",
          )
          .optional(),
      }),
    )
    .max(4),
  /** Monthly estimates for this exact query before the audit month, kept when no rise qualified. */
  observedMonths: z
    .array(z.object({ period, volume }))
    .min(1)
    .max(MAX_SEASONAL_HISTORY_MONTHS)
    .refine(
      (months) => chronological(months.map((row) => row.period)),
      "Observed months must be distinct and chronological",
    )
    .optional(),
});
/** Core sets the action ID. An imported report cannot. */
export const seoWorkspaceSeasonalIdeaSchema = seoSeasonalIdeaSchema.extend({
  actionId: z.string().optional(),
});
