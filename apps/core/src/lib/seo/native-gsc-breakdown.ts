import { z } from "@hono/zod-openapi";
import countries from "i18n-iso-countries";

import {
  SEO_BREAKDOWN_ROW_LIMIT,
  type SeoSearchBreakdown,
  seoSearchBreakdownSchema,
} from "@/schemas/project-seo.schema";
import {
  type SeoSearchType,
  seoSearchTypeHasQueries,
} from "@/schemas/project-seo-traffic.schema";
import { gscNumberSchema } from "./native-gsc-queries";
import {
  gscSearchAnalyticsArguments,
  type NativeStatisticsQuery,
} from "./native-statistics";

export type GscBreakdownDimension = "country" | "device";
const GSC_DEVICES = new Set(["desktop", "mobile", "tablet"]);
const rowFields = {
  keys: z.array(z.string()),
  clicks: gscNumberSchema,
  impressions: gscNumberSchema,
  ctr: gscNumberSchema,
};
function reportOf<Row extends z.ZodTypeAny>(row: Row) {
  return z.object({
    rows: z.array(row).max(SEO_BREAKDOWN_ROW_LIMIT).default([]),
  });
}
const reportSchema = reportOf(
  z.object({ ...rowFields, position: gscNumberSchema }),
);
/** Discover and Google News rows may come without a position, as in the totals read. */
const feedReportSchema = reportOf(
  z.object({ ...rowFields, position: gscNumberSchema.optional() }),
);

/**
 * Same pages, dates and search type as the totals, grouped by one dimension.
 * Google aggregates a country or device grouping by property unless told
 * otherwise; the totals are per page, so the split asks for the same.
 */
export function gscBreakdownArguments(
  query: NativeStatisticsQuery,
  dimension: GscBreakdownDimension,
): Record<string, unknown> {
  return {
    ...gscSearchAnalyticsArguments(query, [dimension], SEO_BREAKDOWN_ROW_LIMIT),
    aggregation_type: "byPage",
  };
}

/** Search Console names a country by its lowercase ISO alpha-3 code. */
function countryKey(code: string): string {
  if (!/^[a-z]{3}$/i.test(code))
    throw new Error("Search Console returned an unreadable country");
  const upper = code.toUpperCase();
  return countries.alpha3ToAlpha2(upper) ?? upper;
}

function deviceKey(code: string): string {
  const lower = code.toLowerCase();
  if (!GSC_DEVICES.has(lower))
    throw new Error("Search Console returned an unknown device");
  return lower;
}

/**
 * Validates one grouped response. A different grouping, an unreadable key or a
 * duplicate refuses the whole read. Rows keep Search Console's click order.
 */
export function normalizeGscBreakdown(
  dimension: GscBreakdownDimension,
  input: unknown,
  searchType?: SeoSearchType,
): SeoSearchBreakdown {
  // Discover and Google News are the feed types: the ones without query rows.
  const report = (
    seoSearchTypeHasQueries(searchType) ? reportSchema : feedReportSchema
  ).parse(input);
  const seen = new Set<string>();
  const rows = report.rows.map((row) => {
    if (row.keys.length !== 1)
      throw new Error("Search Console returned a different grouping");
    const key =
      dimension === "country"
        ? countryKey(row.keys[0])
        : deviceKey(row.keys[0]);
    if (seen.has(key))
      throw new Error("Search Console returned a duplicate grouped row");
    seen.add(key);
    return {
      key,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      averagePosition: row.position ?? null,
    };
  });
  return seoSearchBreakdownSchema.parse({
    rowLimit: SEO_BREAKDOWN_ROW_LIMIT,
    truncated: report.rows.length >= SEO_BREAKDOWN_ROW_LIMIT,
    rows,
  });
}
