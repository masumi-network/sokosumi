/** Pricing for SEO checks. One credit is one US cent. */

/** The owner's price for paid data: its cost plus 50%. */
export const PAID_DATA_MARKUP_PERCENT = 150;
/** Minimum charge for a completed full audit and the price of older fixed approvals. */
export const SEO_FULL_AUDIT_CREDITS = 750;
export const SEO_FULL_AUDIT_MARKUP_PERCENT = 50;

export function seoFullAuditPrice(maxCredits?: typeof SEO_FULL_AUDIT_CREDITS) {
  return {
    kind: "cost_plus" as const,
    version: 1 as const,
    minimumCredits: SEO_FULL_AUDIT_CREDITS,
    markupPercent: SEO_FULL_AUDIT_MARKUP_PERCENT,
    ...(maxCredits === undefined ? {} : { maxCredits }),
  } as const;
}
/** Provider spending bound for a newly priced full audit. */
export const SEO_FULL_AUDIT_MAX_PROVIDER_USD = 5;
/** The worker's reserve of paid data for one page. */
export const SEO_PAGE_CEILING_CENTS = 33;
/** The ceiling of one paid call of a focused check (live SERP is about 0.6, a backlinks summary about 2.4). */
const SEO_MAX_CALL_CENTS = 5;
/** The worker's USD limit of a multi-page full audit when the request sets none. */
export const SEO_DEFAULT_FULL_AUDIT_USD = 3;

/** Maximum site-audit duration accepted by the public SEO worker. */
export const SEO_FULL_AUDIT_MAX_SECONDS = 5400;
/** The most pages one full audit reads: the selected pages and the pages the audit adds. */
const SEO_FULL_AUDIT_MAX_PAGES = 10;
/**
 * The most pages a full audit adds to the selected ones (owner decision 2026-11-22). The audit picks them from the
 * site by the goal of the first page. Each one costs at most one page reserve inside the audit's USD limit.
 */
const SEO_FULL_AUDIT_AUTO_PAGES = 4;
/** How many pages a full audit of this many selected pages may add. */
export const seoFullAuditAutoPages = (selectedPages: number): number =>
  Math.max(
    0,
    Math.min(
      SEO_FULL_AUDIT_AUTO_PAGES,
      SEO_FULL_AUDIT_MAX_PAGES - selectedPages,
    ),
  );

const CENTS_PER_USD = 100;
/** The smallest USD limit of a multi-page full audit: the worker refuses a limit below one page's reserve. */
export const SEO_MIN_AUDIT_USD = SEO_PAGE_CEILING_CENTS / CENTS_PER_USD;
const PERCENT = 100;

export type SeoCreditCeilingInput =
  | { kind: "audit_full"; pages: number; usd?: number }
  | { kind: "focused"; providerCalls: number };

/** Credits for a cost in whole cents with the markup, rounded up. */
export function seoCreditsForCents(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("SEO cost must be a whole number of cents");
  return Math.floor((cents * PAID_DATA_MARKUP_PERCENT + PERCENT - 1) / PERCENT);
}

/** The ceiling of one check: 0 for a check that reads no paid data. */
export function seoMaxCredits(input: SeoCreditCeilingInput): number {
  if (input.kind === "focused")
    return seoCreditsForCents(input.providerCalls * SEO_MAX_CALL_CENTS);
  return SEO_FULL_AUDIT_CREDITS;
}
