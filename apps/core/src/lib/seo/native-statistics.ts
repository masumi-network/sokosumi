import { z } from "@hono/zod-openapi";
import {
  SEO_STATISTICS_ANALYTICS_NO_AGGREGATE_NOTE,
  SEO_STATISTICS_ANALYTICS_THRESHOLDING_NOTE,
  SEO_STATISTICS_ANALYTICS_TIME_ZONE_NOTE,
  SEO_STATISTICS_ANALYTICS_TRUNCATED_NOTE,
  SEO_STATISTICS_NO_AGGREGATE_NOTE,
  SEO_STATISTICS_QUERY_FAILED_NOTE,
  SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE,
} from "@sokosumi/utils";

import type { NativeSeoMetrics } from "@/schemas/project-seo.schema";
import {
  type SeoSearchType,
  type SeoTrafficChannel,
  seoSearchTypeHasQueries,
} from "@/schemas/project-seo-traffic.schema";

export const SEO_STATS_MAX_DAYS = 366;
export const SEO_STATS_MAX_ROWS = 400;
export const SEO_STATS_PAYLOAD_LIMIT = 2 * 1024 * 1024;
export const SEO_STATS_PROVIDERS = ["ga4", "search_console"] as const;
export const GA4_STATS_TOOL = "GOOGLE_ANALYTICS_RUN_REPORT";
export const GSC_STATS_TOOL = "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY";
export const GA4_PROPERTIES_TOOL = "GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES";
export const GSC_PROPERTIES_TOOL = "GOOGLE_SEARCH_CONSOLE_LIST_SITES";
const GSC_TIME_ZONE = "America/Los_Angeles";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GA4_METRICS = [
  {
    name: "screenPageViews",
    key: "page_views",
    label: "Page views",
    unit: "count",
  },
  {
    name: "activeUsers",
    key: "active_users",
    label: "Active users",
    unit: "count",
  },
  {
    name: "sessions",
    key: "sessions",
    label: "Sessions on selected pages",
    unit: "count",
  },
  {
    name: "userEngagementDuration",
    key: "engagement_seconds",
    label: "Engagement time",
    unit: "seconds",
  },
] as const;
const GSC_METRICS = [
  { name: "clicks", label: "Search clicks", unit: "count" },
  { name: "impressions", label: "Search impressions", unit: "count" },
  { name: "ctr", label: "Search click-through rate", unit: "ratio" },
  { name: "position", label: "Search average position", unit: "position" },
] as const;
const valueSchema = z
  .union([z.string().regex(/^\d+(?:\.\d+)?$/), z.number()])
  .transform(Number)
  .pipe(z.number().finite().nonnegative());
export const ga4ReportSchema = z.object({
  dimensionHeaders: z.array(z.object({ name: z.string() })).default([]),
  metricHeaders: z.array(z.object({ name: z.string() })),
  rows: z
    .array(
      z.object({
        dimensionValues: z.array(z.object({ value: z.string() })).default([]),
        metricValues: z.array(z.object({ value: valueSchema })),
      }),
    )
    .max(SEO_STATS_MAX_ROWS)
    .default([]),
  rowCount: z.number().int().nonnegative().optional(),
  metadata: z
    .object({
      timeZone: z.string().optional(),
      subjectToThresholding: z.boolean().optional(),
      dataLossFromOtherRow: z.boolean().optional(),
    })
    .optional(),
});
const gscRowFields = {
  keys: z.array(z.string()).default([]),
  clicks: valueSchema,
  impressions: valueSchema,
  ctr: valueSchema,
};
function gscReportOf<Row extends z.ZodTypeAny>(row: Row) {
  return z.object({
    rows: z.array(row).max(SEO_STATS_MAX_ROWS).default([]),
  });
}
const gscReportSchema = gscReportOf(
  z.object({ ...gscRowFields, position: valueSchema }),
);
/**
 * Discover and Google News rows may come without a position. The Search Analytics API page
 * (developers.google.com/webmaster-tools/v1/searchanalytics/query) does not say position is
 * absent there, so this is a guard, not a known shape: a missing position reads as no value.
 */
const feedGscReportSchema = gscReportOf(
  z.object({ ...gscRowFields, position: valueSchema.optional() }),
);
export interface NativeStatisticsQuery {
  provider: (typeof SEO_STATS_PROVIDERS)[number];
  propertyId: string;
  pageUrls: string[];
  from: string;
  to: string;
  channel: SeoTrafficChannel;
  /** Search Console only. Absent reads web search. */
  searchType?: SeoSearchType;
}
export interface SeoNativeTool {
  slug: string;
  readOnly: boolean;
  inputSchema: unknown;
}

/** Composio can return JSON text inside its tool data. Failed envelopes never supply observations. */
export function unwrapNativeStatistics(
  input: unknown,
  expectedKeys: string[],
): Record<string, unknown> {
  let value = input;
  for (let depth = 0; depth < 4; depth++) {
    if (
      Buffer.byteLength(
        typeof value === "string" ? value : (JSON.stringify(value) ?? ""),
      ) > SEO_STATS_PAYLOAD_LIMIT
    )
      throw new Error("Statistics response exceeded its limit");
    if (typeof value === "string") value = JSON.parse(value);
    const parsed = z.record(z.string(), z.unknown()).parse(value);
    if (
      (parsed.successful !== undefined && parsed.successful !== true) ||
      (parsed.success !== undefined && parsed.success !== true) ||
      parsed.error
    )
      throw new Error("Native statistics query failed");
    if (expectedKeys.some((key) => Object.hasOwn(parsed, key))) return parsed;
    const next = parsed.data ?? parsed.response ?? parsed.response_data;
    if (next === undefined || next === null) return parsed;
    value = next;
  }
  throw new Error("Native statistics response format is unavailable");
}

function normalizedKey(key: string): string {
  return key.replaceAll("_", "").toLowerCase();
}

/** Bind only declared tool arguments. A missing page/date filter refuses the read. */
export function bindSeoToolArguments(
  tool: SeoNativeTool,
  logical: Record<string, unknown>,
): Record<string, unknown> {
  if (!tool.readOnly)
    throw new Error("Statistics require a read-only native tool");
  const shape = z
    .object({
      properties: z.record(z.string(), z.unknown()),
      required: z.array(z.string()).default([]),
    })
    .parse(tool.inputSchema);
  const arguments_: Record<string, unknown> = {};
  const keys = Object.keys(shape.properties);
  for (const [key, value] of Object.entries(logical)) {
    const declared = keys.find(
      (candidate) => normalizedKey(candidate) === normalizedKey(key),
    );
    if (!declared)
      throw new Error(`Native statistics tool does not support ${key}`);
    arguments_[declared] = value;
  }
  if (shape.required.some((key) => !Object.hasOwn(arguments_, key)))
    throw new Error("Native statistics tool requires unsupported arguments");
  return arguments_;
}

/**
 * GA4 default channel group names per channel. Source: support.google.com/analytics/answer/9756891
 * (the lead's fetch). The default channel is exactly "AI Assistant" (rule: medium exactly
 * "ai-assistant"); it covers ChatGPT, Gemini, Deepseek, Copilot and Grok. AI Overviews and
 * AI Mode stay in Organic Search.
 */
export const GA4_CHANNEL_GROUPS = {
  organic: "Organic Search",
  ai_assistant: "AI Assistant",
} as const satisfies Record<Exclude<SeoTrafficChannel, "all">, string>;
/** Sessions of one GA4 default channel group, matched exactly. */
export function ga4ChannelGroupFilter(group: string) {
  return {
    filter: {
      fieldName: "sessionDefaultChannelGroup",
      stringFilter: { matchType: "EXACT", value: group, caseSensitive: true },
    },
  };
}

export function ga4StatisticsArguments(
  query: NativeStatisticsQuery,
  daily: boolean,
): Record<string, unknown> {
  const pageFilter = {
    filter: {
      fieldName: "pageLocation",
      inListFilter: {
        values: [...new Set(query.pageUrls)],
        caseSensitive: true,
      },
    },
  };
  return {
    property: query.propertyId,
    dateRanges: [{ startDate: query.from, endDate: query.to }],
    dimensions: daily ? [{ name: "date" }] : [],
    metrics: GA4_METRICS.map(({ name }) => ({ name })),
    dimensionFilter:
      query.channel === "all"
        ? pageFilter
        : {
            andGroup: {
              expressions: [
                pageFilter,
                ga4ChannelGroupFilter(GA4_CHANNEL_GROUPS[query.channel]),
              ],
            },
          },
    limit: SEO_STATS_MAX_ROWS,
    returnPropertyQuota: true,
  };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function gscStatisticsArguments(
  query: NativeStatisticsQuery,
  daily: boolean,
): Record<string, unknown> {
  return gscSearchAnalyticsArguments(
    query,
    daily ? ["date"] : [],
    SEO_STATS_MAX_ROWS,
  );
}

/** One page filter for every Search Console read, so totals, days and query rows share a scope. */
export function gscSearchAnalyticsArguments(
  query: NativeStatisticsQuery,
  dimensions: string[],
  rowLimit: number,
): Record<string, unknown> {
  const expression = `^(?:${[...new Set(query.pageUrls)].map(escapeRegex).join("|")})$`;
  if (expression.length > 4096)
    throw new Error("Select fewer pages for this Search Console query");
  return {
    site_url: query.propertyId,
    start_date: query.from,
    end_date: query.to,
    dimensions,
    search_type: query.searchType ?? "web",
    data_state: "final",
    dimension_filter_groups: [
      {
        groupType: "and",
        filters: [
          { dimension: "page", operator: "includingRegex", expression },
        ],
      },
    ],
    row_limit: rowLimit,
    start_row: 0,
  };
}

const DAY_MS = 86_400_000;
/** The equal-length window that ends the day before the period starts. */
export function previousSeoPeriod(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - start) / DAY_MS) + 1;
  const date = (offset: number) =>
    new Date(start + offset * DAY_MS).toISOString().slice(0, 10);
  return { from: date(-days), to: date(-1) };
}

/** Search Console keeps about 16 months of data; this stays inside it. */
export const GSC_RETENTION_DAYS = 480;
export function withinSearchConsoleRetention(from: string, now = new Date()) {
  return (
    Date.parse(`${from}T00:00:00Z`) >=
    now.getTime() - GSC_RETENTION_DAYS * DAY_MS
  );
}

/** Search Console's final data trails today by about 3 days. */
export const GSC_FINAL_LAG_DAYS = 3;
/** Search Console dates its days in Pacific Time. */
const GSC_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
});
/**
 * The last day of the period Google has settled. A quiet page has no rows on
 * its last days, so its last row is not the processing lag.
 */
export function searchConsoleSettledEnd(
  to: string,
  lastReported: string,
  now = new Date(),
) {
  const settled = GSC_DAY.format(
    new Date(now.getTime() - GSC_FINAL_LAG_DAYS * DAY_MS),
  );
  const end = settled < to ? settled : to;
  return lastReported > end ? lastReported : end;
}

export function withinPeriod(
  date: string,
  query: NativeStatisticsQuery,
): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    DATE.test(date) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date &&
    date >= query.from &&
    date <= query.to
  );
}
function ga4Date(value: string): string {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value;
}

/** Totals come from the ungrouped provider query, never by summing users or averages. */
export function normalizeGa4Statistics(
  query: NativeStatisticsQuery,
  periodInput: unknown,
  dailyInput: unknown,
  observedAt: string,
): NativeSeoMetrics {
  const empty = (daily: boolean) => ({
    dimensionHeaders: daily ? [{ name: "date" }] : [],
    metricHeaders: GA4_METRICS.map(({ name }) => ({ name })),
    rows: [],
  });
  const period = ga4ReportSchema.parse(periodInput ?? empty(false)),
    daily = ga4ReportSchema.parse(dailyInput ?? empty(true));
  for (const report of [period, daily]) {
    if (
      report.metricHeaders.map((header) => header.name).join() !==
      GA4_METRICS.map((metric) => metric.name).join()
    )
      throw new Error("Analytics returned different metric definitions");
    if (
      report.rows.some((row) => row.metricValues.length !== GA4_METRICS.length)
    )
      throw new Error("Analytics metric values are incomplete");
  }
  if (
    period.dimensionHeaders.length ||
    period.rows.length > 1 ||
    daily.dimensionHeaders.map((header) => header.name).join() !== "date"
  )
    throw new Error("Analytics returned a different grouping");
  const points = daily.rows
    .map((row) => {
      if (row.dimensionValues.length !== 1)
        throw new Error("Analytics returned a different date grouping");
      const date = ga4Date(row.dimensionValues[0].value);
      if (!withinPeriod(date, query))
        throw new Error(
          "Analytics returned a date outside the selected period",
        );
      return { date, values: row.metricValues.map((metric) => metric.value) };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(points.map((point) => point.date)).size !== points.length)
    throw new Error("Analytics returned duplicate dates");
  const zones = [period.metadata?.timeZone, daily.metadata?.timeZone].filter(
    (zone): zone is string => !!zone,
  );
  if (new Set(zones).size > 1)
    throw new Error("Analytics returned incompatible time zones");
  const notes: string[] = [];
  if (periodInput === null || dailyInput === null)
    notes.push(SEO_STATISTICS_QUERY_FAILED_NOTE);
  if (!zones.length) notes.push(SEO_STATISTICS_ANALYTICS_TIME_ZONE_NOTE);
  if (!period.rows.length)
    notes.push(SEO_STATISTICS_ANALYTICS_NO_AGGREGATE_NOTE);
  if (
    [period, daily].some(
      (report) =>
        report.metadata?.subjectToThresholding ||
        report.metadata?.dataLossFromOtherRow,
    )
  )
    notes.push(SEO_STATISTICS_ANALYTICS_THRESHOLDING_NOTE);
  if ((daily.rowCount ?? daily.rows.length) > daily.rows.length)
    notes.push(SEO_STATISTICS_ANALYTICS_TRUNCATED_NOTE);
  const coverage =
    !period.rows.length && !daily.rows.length
      ? "unavailable"
      : notes.length
        ? "partial"
        : "complete";
  return {
    provider: "ga4",
    propertyId: query.propertyId,
    pageUrls: query.pageUrls,
    channel: query.channel,
    from: query.from,
    to: query.to,
    timeZone: zones[0] ?? "not_determined",
    observedAt,
    coverage,
    notes,
    metrics: GA4_METRICS.map((metric, index) => ({
      key: metric.key,
      label: metric.label,
      unit: metric.unit,
      value: period.rows[0]?.metricValues[index]?.value ?? null,
      points: points.map((point) => ({
        date: point.date,
        value: point.values[index],
      })),
    })),
  };
}

type GscRow = z.infer<typeof feedGscReportSchema>["rows"][number];
/** A day or period with no impressions has no CTR or position; Search Console reports 0 there. */
function gscValue(row: GscRow, name: (typeof GSC_METRICS)[number]["name"]) {
  return (name === "ctr" || name === "position") && row.impressions === 0
    ? null
    : (row[name] ?? null);
}

export function normalizeGscStatistics(
  query: NativeStatisticsQuery,
  periodInput: unknown,
  dailyInput: unknown,
  observedAt: string,
): NativeSeoMetrics {
  // Discover and Google News are the feed types: the ones without query rows.
  const schema = seoSearchTypeHasQueries(query.searchType)
    ? gscReportSchema
    : feedGscReportSchema;
  const period = schema.parse(periodInput ?? {}),
    daily = schema.parse(dailyInput ?? {});
  if (
    period.rows.length > 1 ||
    period.rows.some((row) => row.keys.length) ||
    daily.rows.some(
      (row) => row.keys.length !== 1 || !withinPeriod(row.keys[0], query),
    )
  )
    throw new Error("Search Console returned a different period or grouping");
  if (new Set(daily.rows.map((row) => row.keys[0])).size !== daily.rows.length)
    throw new Error("Search Console returned duplicate dates");
  const notes = [SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE];
  if (periodInput === null || dailyInput === null)
    notes.push(SEO_STATISTICS_QUERY_FAILED_NOTE);
  if (!period.rows.length) notes.push(SEO_STATISTICS_NO_AGGREGATE_NOTE);
  return {
    provider: "search_console",
    propertyId: query.propertyId,
    pageUrls: query.pageUrls,
    channel: "organic",
    // Web reads keep their old shape, so a repeated web sync still dedupes against older ones.
    ...(query.searchType && query.searchType !== "web"
      ? { searchType: query.searchType }
      : {}),
    from: query.from,
    to: query.to,
    timeZone: GSC_TIME_ZONE,
    observedAt,
    coverage:
      !period.rows.length && !daily.rows.length ? "unavailable" : "partial",
    notes,
    metrics: GSC_METRICS.map((metric) => ({
      key: metric.name,
      label: metric.label,
      unit: metric.unit,
      value: period.rows[0] ? gscValue(period.rows[0], metric.name) : null,
      points: [...daily.rows]
        .sort((a, b) => a.keys[0].localeCompare(b.keys[0]))
        .map((row) => ({
          date: row.keys[0],
          value: gscValue(row, metric.name),
        })),
    })),
  };
}
