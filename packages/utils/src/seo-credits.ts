/**
 * The most an SEO check can charge, in whole credits.
 *
 * The SEO check service charges each completed check its DataForSEO cost plus
 * the markup, rounded up to a whole credit, and never more than this ceiling
 * (seo-bot `agent/lib/run-cost.ts`). Core refuses a check the payer's balance
 * cannot cover, and the analysis dialog shows the same figure as "up to", so
 * both run this one formula. A failed check charges nothing.
 *
 * 1 credit = 1 cent. Keep the constants in step with seo-bot's run-cost.ts.
 */

/** The owner's price for paid data: its cost plus 50%. */
export const SEO_MARKUP_PERCENT = 150;
/** A one-page full audit has no USD limit; the worker's page reserve bounds it. */
export const SEO_PAGE_CEILING_CENTS = 30;
/** The ceiling of one paid call of a focused check (live SERP is about 0.6, a backlinks summary about 2.4). */
export const SEO_MAX_CALL_CENTS = 5;
/** The worker's USD limit of a multi-page full audit when the request sets none. */
export const SEO_DEFAULT_FULL_AUDIT_USD = 3;

const CENTS_PER_USD = 100;
const PERCENT = 100;

export type SeoCreditCeilingInput =
  | { kind: "audit_full"; pages: number; usd?: number }
  | { kind: "focused"; providerCalls: number };

/** Credits for a cost in whole cents with the markup, rounded up. */
export function seoCreditsForCents(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("SEO cost must be a whole number of cents");
  return Math.floor((cents * SEO_MARKUP_PERCENT + PERCENT - 1) / PERCENT);
}

/** The ceiling of one check: 0 for a check that reads no paid data. */
export function seoMaxCredits(input: SeoCreditCeilingInput): number {
  if (input.kind === "focused")
    return seoCreditsForCents(input.providerCalls * SEO_MAX_CALL_CENTS);
  if (input.pages <= 1) return seoCreditsForCents(SEO_PAGE_CEILING_CENTS);
  return seoCreditsForCents(
    Math.round((input.usd ?? SEO_DEFAULT_FULL_AUDIT_USD) * CENTS_PER_USD),
  );
}
