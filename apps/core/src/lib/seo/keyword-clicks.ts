/**
 * Estimated organic clicks a month at a Google position: monthly searches times the click-through rate
 * of that position. An estimate, not a measurement: the reader sees the source next to every number.
 *
 * Source: Advanced Web Ranking, organic CTR study, July 2026 (https://www.advancedwebranking.com/seo/organic-ctr).
 * - Positions 1 to 10: "CTR by position: branded vs. unbranded queries", unbranded, Google US, all devices.
 * - Positions 11 to 20: "Organic CTR by position", all SERPs, Google US, desktop, the only table past 10.
 *   Each is capped at the place above it: a lower place never gets more clicks.
 * Below position 20, or with no position, the estimate is no clicks.
 */
export const SEO_CTR_SOURCE = "awr-2026-07";

/** Percent, positions 1 to 10, unbranded queries. */
const TOP_10_PERCENT = [
  19.38, 9.64, 6.02, 3.88, 2.68, 1.86, 1.37, 1.1, 0.94, 0.81,
] as const;
/** Percent, positions 11 to 20, as published (all SERPs, desktop). */
const PAGE_2_PERCENT = [
  0.67, 0.7, 0.82, 0.88, 0.8, 0.67, 0.64, 0.55, 0.52, 0.27,
] as const;

const CTR_BY_POSITION: readonly number[] = [
  ...TOP_10_PERCENT,
  ...PAGE_2_PERCENT,
].reduce<number[]>((curve, percent) => {
  curve.push(Math.min(percent / 100, curve.at(-1) ?? 1));
  return curve;
}, []);

/** The click-through rate of a Google position; 0 past the last published place. */
export function seoClickRate(position: number | null) {
  if (position === null || !Number.isFinite(position)) return 0;
  // An average position (Search Console) counts as its nearest place.
  const place = Math.round(position);
  return place >= 1 ? (CTR_BY_POSITION[place - 1] ?? 0) : 0;
}

export interface SeoKeywordClicks {
  now: number;
  top10: number;
  top3: number;
  top1: number;
}

/** Clicks a month now and at three goal places. Null without a search volume: no volume, no estimate. */
export function seoKeywordClicks(
  volume: number | null,
  position: number | null,
): SeoKeywordClicks | null {
  if (volume === null || !Number.isFinite(volume) || volume < 0) return null;
  const at = (place: number | null) => Math.round(volume * seoClickRate(place));
  return { now: at(position), top10: at(10), top3: at(3), top1: at(1) };
}
