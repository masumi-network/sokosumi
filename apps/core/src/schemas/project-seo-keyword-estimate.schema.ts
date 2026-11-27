import { z } from "@hono/zod-openapi";

/** The SEO bot's estimate of how likely a searcher takes the page's action. It is not a measured rate. */
export const seoConversionSchema = z.enum(["high", "medium", "low"]);
/** What the searcher looks for, as the SEO bot classed the keyword. The estimate comes from this and the fit. */
export const seoIntentClassSchema = z.enum([
  "product",
  "comparison",
  "problem",
  "learn",
]);
/** How well the page's product matches what the searcher looks for. */
export const seoFitSchema = z.enum(["direct", "partial"]);

/** The reason behind an estimate. A check from before the reason was kept has none. */
export const seoEstimateReasonFields = {
  intentClass: seoIntentClassSchema.nullable().optional(),
  fit: seoFitSchema.nullable().optional(),
};

/** The estimate fields of a keyword row in the SEO workspace. */
export const seoKeywordEstimateFields = {
  conversion: seoConversionSchema.nullable(),
  /** The product feature the keyword is about, in the words of the check. */
  feature: z.string().nullable(),
  ...seoEstimateReasonFields,
};
