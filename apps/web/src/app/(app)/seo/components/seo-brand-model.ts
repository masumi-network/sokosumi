import type { SeoSiteTrafficReport } from "@sokosumi/core-client";
import { seoBrandMatcher } from "@sokosumi/utils";

/** Which queries the Search Console table lists. */
export const SEO_BRAND_VIEWS = ["all", "branded", "non_branded"] as const;
export type SeoBrandView = (typeof SEO_BRAND_VIEWS)[number];

/** One brand term per line or between commas; blanks are dropped. */
export function seoParseBrandTerms(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

interface BrandRow {
  query: string;
  clicks: number;
  impressions: number;
}

/** The listed rows of one view. Without brand terms every view lists all rows. */
export function seoBrandRows<T extends BrandRow>(
  rows: T[],
  terms: string[],
  view: SeoBrandView,
): T[] {
  if (view === "all" || !terms.length) return rows;
  const branded = seoBrandMatcher(terms);
  return rows.filter((row) => branded(row.query) === (view === "branded"));
}

/** Clicks and impressions of the listed branded and non-branded queries. Hidden queries are in neither. */
export function seoBrandTotals(rows: BrandRow[], terms: string[]) {
  const totals = {
    branded: { clicks: 0, impressions: 0 },
    nonBranded: { clicks: 0, impressions: 0 },
  };
  const branded = seoBrandMatcher(terms);
  for (const row of rows) {
    const side = branded(row.query) ? totals.branded : totals.nonBranded;
    side.clicks += row.clicks;
    side.impressions += row.impressions;
  }
  return totals;
}

/** The parts of the site split. `unlisted` is traffic Google counts in the total but lists under no query. */
export const SEO_BRAND_BUCKETS = ["branded", "nonBranded", "unlisted"] as const;
export type SeoBrandBucket = (typeof SEO_BRAND_BUCKETS)[number];

/**
 * One metric of the site split, in total and per day. Null without a split in the report.
 * `unlisted` is the day total minus both listed sides. It is null when it cannot be proved:
 * the query rows were cut at the read limit, the report has no day totals, the rows hold a
 * day the totals do not have, or the rows exceed a day total. `all` is the traffic total
 * the shares are of; null when the day totals are absent or disagree with the rows.
 */
export function seoSiteBrandSplit(
  report: Pick<SeoSiteTrafficReport, "daily" | "brand">,
  metric: "clicks" | "impressions",
) {
  const { brand } = report;
  if (!brand) return null;
  const rows = new Map(brand.daily.map((day) => [day.date, day]));
  const totals = new Map(report.daily?.map((day) => [day.date, day[metric]]));
  // Every day of either read is a point, so a trend shows all the traffic its total counts.
  const dates = [...new Set([...totals.keys(), ...rows.keys()])].sort();
  // After a cut read, a day without rows is not known to be zero.
  const none = brand.limited ? null : 0;
  const side = (key: "branded" | "nonBranded") =>
    dates.map((date) => ({
      date,
      value: rows.get(date)?.[key][metric] ?? none,
    }));
  const branded = side("branded");
  const nonBranded = side("nonBranded");
  const rest = dates.map((date, i) => ({
    date,
    value:
      (totals.get(date) ?? Number.NaN) -
      (branded[i]?.value ?? 0) -
      (nonBranded[i]?.value ?? 0),
  }));
  // A day without a total gives NaN, which fails the comparison too.
  const consistent = totals.size > 0 && rest.every((point) => point.value >= 0);
  const unlisted = consistent && !brand.limited ? rest : null;
  const sum = (values: number[]) =>
    values.reduce((total, value) => total + value, 0);
  const values = (points: { value: number | null }[]) =>
    sum(points.map((point) => point.value ?? 0));
  return {
    all: consistent ? sum([...totals.values()]) : null,
    limited: brand.limited,
    totals: {
      branded: values(branded),
      nonBranded: values(nonBranded),
      unlisted: unlisted && values(unlisted),
    },
    points: { branded, nonBranded, unlisted },
  };
}

/**
 * Start values for an empty term list, from the site name: "battery-sensei.app" gives
 * "battery sensei" and "batterysensei". Only a host of a name and one ending gives a
 * suggestion: in "support.example.com" or "example.co.uk" the name is not sure. The owner
 * checks the terms before a save.
 */
export function seoBrandSuggestion(host: string): string[] {
  const labels = host.replace(/^www\./, "").split(".");
  const name = labels.length === 2 ? (labels[0] ?? "") : "";
  // A punycode label is not the name as people type it.
  if (name.startsWith("xn--")) return [];
  const words = name.replace(/[-_]+/g, " ").trim();
  return [...new Set([words, words.replaceAll(" ", "")])].filter(Boolean);
}
