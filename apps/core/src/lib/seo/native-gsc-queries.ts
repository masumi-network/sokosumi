import { z } from "@hono/zod-openapi";

import {
  type NativeSeoMetrics,
  SEO_SEARCH_QUERY_ROW_LIMIT,
  seoSearchQueryRowSchema,
} from "@/schemas/project-seo.schema";
import {
  gscSearchAnalyticsArguments,
  type NativeStatisticsQuery,
} from "./native-statistics";

const GSC_QUERY_DIMENSIONS = ["query", "page"];
const numberSchema = z
  .union([z.string().regex(/^\d+(?:\.\d+)?$/), z.number()])
  .transform(Number)
  .pipe(z.number().finite().nonnegative());
const gscQueryReportSchema = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()),
        clicks: numberSchema,
        impressions: numberSchema,
        ctr: numberSchema,
        position: numberSchema,
      }),
    )
    .max(SEO_SEARCH_QUERY_ROW_LIMIT)
    .default([]),
});

export type NativeSearchQueries = NonNullable<NativeSeoMetrics["queries"]>;

/** Same property, pages, dates and search type as the totals; grouped by query and page. */
export function gscQueryArguments(
  query: NativeStatisticsQuery,
): Record<string, unknown> {
  return gscSearchAnalyticsArguments(
    query,
    GSC_QUERY_DIMENSIONS,
    SEO_SEARCH_QUERY_ROW_LIMIT,
  );
}

function pageKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

/**
 * Validates one query/page response against the requested scope. A row outside
 * the selected pages, a malformed grouping or a duplicate refuses the whole read.
 * Search Console orders rows by clicks; a full page means more rows can exist.
 */
export function normalizeGscQueries(
  query: NativeStatisticsQuery,
  input: unknown,
): NativeSearchQueries {
  const report = gscQueryReportSchema.parse(input);
  const pages = new Map(query.pageUrls.map((url) => [pageKey(url), url]));
  const seen = new Set<string>();
  const rows = report.rows.map((row) => {
    if (row.keys.length !== GSC_QUERY_DIMENSIONS.length)
      throw new Error("Search Console returned a different query grouping");
    const [text, page] = row.keys;
    if (!URL.canParse(page))
      throw new Error("Search Console returned an unreadable page URL");
    const pageUrl = pages.get(pageKey(page));
    if (!pageUrl)
      throw new Error("Search Console returned a page outside the selection");
    const identity = JSON.stringify([text, pageUrl]);
    if (seen.has(identity))
      throw new Error("Search Console returned a duplicate query row");
    seen.add(identity);
    return seoSearchQueryRowSchema.parse({
      query: text,
      pageUrl,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      averagePosition: row.position,
    });
  });
  return {
    rowLimit: SEO_SEARCH_QUERY_ROW_LIMIT,
    truncated: rows.length >= SEO_SEARCH_QUERY_ROW_LIMIT,
    rows,
  };
}
