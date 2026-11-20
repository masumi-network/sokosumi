import { PAID_DATA_MARKUP_PERCENT } from "@sokosumi/utils";

/**
 * The most each paid call of one competitor's weekly check costs, in US
 * dollars, measured on 2026-11-18 over five competitors with the check's own
 * code: Exa billed every news search $0.007, sorting its results cost
 * $0.0011 to $0.0029, and comparing a page whose change fills the forty
 * lines a check sends cost $0.0012 to $0.0020. Reading the pages, the Meta
 * Ad Library and Instagram are not billed per call. Production's first ten
 * competitors, whose pages had no earlier reading to compare, cost $0.0088
 * each.
 */
export const COMPETITOR_CHECK_PRICE_VERIFIED_AT = "2026-11-18";
export const COMPETITOR_CHECK_COST_USD = {
  /** One Exa search with ten results and their passages. */
  newsSearch: 0.007,
  /** The model sorting those results into this week's events. */
  newsSort: 0.003,
  /** The model reading what changed on one page. */
  pageChange: 0.002,
};
/** The homepage and the pricing page. */
const PAGES_COMPARED = 2;

/**
 * What one competitor costs in one weekly check, in credits (1 credit = 1
 * cent): the most the check can cost with the markup on paid data, rounded
 * up to a whole credit.
 */
export function competitorCheckCredits(
  cost: typeof COMPETITOR_CHECK_COST_USD = COMPETITOR_CHECK_COST_USD,
): number {
  const tenthsOfACent = Math.round(
    (cost.newsSearch + cost.newsSort + PAGES_COMPARED * cost.pageChange) * 1000,
  );
  return Math.ceil((tenthsOfACent * PAID_DATA_MARKUP_PERCENT) / 1000);
}

export const COMPETITOR_CHECK_CREDITS = competitorCheckCredits();
