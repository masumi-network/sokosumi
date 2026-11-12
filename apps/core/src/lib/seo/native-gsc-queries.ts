import { z } from "@hono/zod-openapi";
import { normalizeSeoQuery } from "@sokosumi/utils";
import countries from "i18n-iso-countries";

import {
  type NativeSeoMetrics,
  SEO_KEYWORD_SERIES_MAX_COUNTRIES,
  SEO_KEYWORD_SERIES_MAX_KEYWORDS,
  SEO_KEYWORD_SERIES_ROW_LIMIT,
  SEO_SEARCH_QUERY_ROW_LIMIT,
  seoKeywordSeriesSchema,
  seoSearchQueryRowSchema,
} from "@/schemas/project-seo.schema";
import {
  escapeRegex,
  gscSearchAnalyticsArguments,
  type NativeStatisticsQuery,
  withinPeriod,
} from "./native-statistics";

const GSC_QUERY_DIMENSIONS = ["query", "page"];
export const gscNumberSchema = z
  .union([z.string().regex(/^\d+(?:\.\d+)?$/), z.number()])
  .transform(Number)
  .pipe(z.number().finite().nonnegative());
const gscQueryReportSchema = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()),
        clicks: gscNumberSchema,
        impressions: gscNumberSchema,
        ctr: gscNumberSchema,
        position: gscNumberSchema,
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

/** Search Console refuses a filter expression longer than this. */
export const GSC_FILTER_EXPRESSION_LIMIT = 4096;
const KEYWORD_SERIES_DIMENSIONS = ["date", "query"];
const NOTE_LIMIT = 2000;
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const gscKeywordSeriesReportSchema = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()),
        clicks: gscNumberSchema,
        impressions: gscNumberSchema,
        position: gscNumberSchema,
      }),
    )
    .max(SEO_KEYWORD_SERIES_ROW_LIMIT)
    .default([]),
});

export type NativeKeywordSeries = NonNullable<
  NativeSeoMetrics["keywordSeries"]
>;
export interface TrackedKeyword {
  keyword: string;
  saved: boolean;
  priority: keyof typeof PRIORITY_RANK;
  countryCode: string;
  /** 0 while the reader stored no choice: a keyword of a check, tracked from the start. */
  version: number;
  /** Why the workspace lists the row; "focus" is a keyword a check set out to read. */
  source: string;
}
/** Keywords read together, filtered to searchers in one country. */
export interface TrackedKeywordGroup {
  countryCode: string;
  keywords: string[];
}

/** Search Console names a country by its lowercase ISO alpha-3 code. */
function gscCountry(countryCode: string): string | undefined {
  return countries.alpha2ToAlpha3(countryCode)?.toLowerCase();
}

function keywordExpression(keywords: string[]): string {
  return `(?i)^(?:${keywords.map(escapeRegex).join("|")})$`;
}

/**
 * Saved keywords, one per normalized key and country at its highest priority.
 * The reader's own choices come first, so the keywords a check tracks from the
 * start never take their place; then priority, then the keywords a check set out
 * to read, then key. Only the reader's own keywords are named as left out.
 * At most 25 fit, in at most 3 countries, each
 * country's set within the filter expression limit. A country Search Console
 * cannot name is left out.
 */
export function selectTrackedKeywords(keywords: TrackedKeyword[]): {
  groups: TrackedKeywordGroup[];
  leftOut: string[];
} {
  const best = new Map<
    string,
    {
      key: string;
      countryCode: string;
      rank: number;
      own: boolean;
      focus: boolean;
    }
  >();
  for (const row of keywords) {
    const key = normalizeSeoQuery(row.keyword);
    if (!row.saved || !key) continue;
    const identity = JSON.stringify([row.countryCode, key]);
    const rank = PRIORITY_RANK[row.priority];
    const known = best.get(identity);
    best.set(identity, {
      key,
      countryCode: row.countryCode,
      rank: Math.min(rank, known?.rank ?? rank),
      own: row.version > 0 || known?.own === true,
      focus: row.source === "focus" || known?.focus === true,
    });
  }
  const ordered = [...best.values()].sort(
    (a, b) =>
      Number(b.own) - Number(a.own) ||
      a.rank - b.rank ||
      Number(b.focus) - Number(a.focus) ||
      a.key.localeCompare(b.key) ||
      a.countryCode.localeCompare(b.countryCode),
  );
  const groups = new Map<string, string[]>();
  const leftOut: string[] = [];
  let chosen = 0;
  for (const { key, countryCode, own } of ordered) {
    const group = groups.get(countryCode) ?? [];
    if (
      chosen < SEO_KEYWORD_SERIES_MAX_KEYWORDS &&
      gscCountry(countryCode) &&
      (groups.has(countryCode) ||
        groups.size < SEO_KEYWORD_SERIES_MAX_COUNTRIES) &&
      keywordExpression([...group, key]).length <= GSC_FILTER_EXPRESSION_LIMIT
    ) {
      group.push(key);
      groups.set(countryCode, group);
      chosen++;
      // A note that names keywords the reader never chose would be noise on every sync.
    } else if (own) leftOut.push(`${key} (${countryCode})`);
  }
  return {
    groups: [...groups].map(([countryCode, chosenKeys]) => ({
      countryCode,
      keywords: chosenKeys,
    })),
    leftOut,
  };
}

/** Names the keywords a sync did not request, as many as fit in one note. */
export function keywordSeriesLeftOutNote(leftOut: string[]): string {
  let note = `Daily positions are read for at most ${SEO_KEYWORD_SERIES_MAX_KEYWORDS} tracked keywords in ${SEO_KEYWORD_SERIES_MAX_COUNTRIES} countries Search Console can filter by, per sync. Not read this time: `;
  for (const [index, keyword] of leftOut.entries()) {
    const name = `${index ? ", " : ""}"${keyword}"`;
    const more = ` and ${leftOut.length - index} more.`;
    if (note.length + name.length + more.length + 1 > NOTE_LIMIT)
      return `${note}${more}`;
    note += name;
  }
  return `${note}.`;
}

/** Same pages, dates and search type as the totals, limited to the tracked keywords and their country, grouped by day. */
export function gscKeywordSeriesArguments(
  query: NativeStatisticsQuery,
  group: TrackedKeywordGroup,
): Record<string, unknown> {
  const { keywords } = group;
  const expression = keywordExpression(keywords.map(normalizeSeoQuery));
  if (!keywords.length || expression.length > GSC_FILTER_EXPRESSION_LIMIT)
    throw new Error(
      "Select fewer tracked keywords for this Search Console query",
    );
  const country = gscCountry(group.countryCode);
  if (!country)
    throw new Error("Search Console cannot filter by this keyword country");
  const args = gscSearchAnalyticsArguments(
    query,
    KEYWORD_SERIES_DIMENSIONS,
    SEO_KEYWORD_SERIES_ROW_LIMIT,
  );
  const [pageGroup] = args.dimension_filter_groups as Array<{
    groupType: string;
    filters: unknown[];
  }>;
  return {
    ...args,
    dimension_filter_groups: [
      {
        ...pageGroup,
        filters: [
          ...pageGroup.filters,
          { dimension: "query", operator: "includingRegex", expression },
          { dimension: "country", operator: "equals", expression: country },
        ],
      },
    ],
  };
}

/**
 * Validates one date/query response against the requested scope. A malformed
 * grouping, a date outside the period, a query outside the requested keywords
 * or a duplicate row refuses the whole read. Case and spacing variants of one
 * keyword merge per day: clicks and impressions add up, position is weighted
 * by impressions and is null when there are none.
 */
export function normalizeGscKeywordSeries(
  query: NativeStatisticsQuery,
  group: TrackedKeywordGroup,
  input: unknown,
): NativeKeywordSeries {
  const { keywords, countryCode } = group;
  const report = gscKeywordSeriesReportSchema.parse(input);
  const days = new Map(
    keywords.map((keyword) => [
      normalizeSeoQuery(keyword),
      new Map<
        string,
        { clicks: number; impressions: number; weighted: number }
      >(),
    ]),
  );
  const seen = new Set<string>();
  for (const row of report.rows) {
    if (row.keys.length !== KEYWORD_SERIES_DIMENSIONS.length)
      throw new Error("Search Console returned a different keyword grouping");
    const [date, text] = row.keys;
    if (!withinPeriod(date, query))
      throw new Error("Search Console returned a date outside the period");
    const byDate = days.get(normalizeSeoQuery(text));
    if (!byDate)
      throw new Error("Search Console returned a query outside the keywords");
    const identity = JSON.stringify([date, text]);
    if (seen.has(identity))
      throw new Error("Search Console returned a duplicate keyword row");
    seen.add(identity);
    const day = byDate.get(date) ?? { clicks: 0, impressions: 0, weighted: 0 };
    day.clicks += row.clicks;
    day.impressions += row.impressions;
    day.weighted += row.position * row.impressions;
    byDate.set(date, day);
  }
  return seoKeywordSeriesSchema.parse({
    rowLimit: SEO_KEYWORD_SERIES_ROW_LIMIT,
    truncated: report.rows.length >= SEO_KEYWORD_SERIES_ROW_LIMIT,
    keywords: [...days].map(([keyword, byDate]) => ({
      keyword,
      countryCode,
      points: [...byDate]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, day]) => ({
          date,
          clicks: day.clicks,
          impressions: day.impressions,
          position: day.impressions ? day.weighted / day.impressions : null,
        })),
    })),
  });
}
