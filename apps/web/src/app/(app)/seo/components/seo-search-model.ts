import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { normalizeSeoQuery } from "@sokosumi/utils";
import { latestSeoMeasurements } from "./seo-statistics-model";

type QueryRow = Omit<
  NonNullable<ProjectSeoWorkspace["searchQueries"]>["rows"][number],
  "id"
>;

const IMPRESSIONS_METRIC = "impressions";

/**
 * Impressions Google counted for the pages but listed under no query, or
 * under no row of a country or device split from the same sync.
 * Null when the total and the rows cannot be proved to come from one sync,
 * when the rows were cut at the row limit, or when the numbers disagree.
 */
export function hiddenImpressions(
  workspace: ProjectSeoWorkspace,
  part:
    | {
        propertyId: string;
        from: string;
        to: string;
        observedAt: Date | string;
        truncated: boolean;
        rows: { impressions: number }[];
      }
    | null
    | undefined = workspace.searchQueries,
) {
  if (!part || part.truncated) return null;
  const total = latestSeoMeasurements(workspace.metrics).find(
    (metric) =>
      metric.source === "search_console" && metric.key === IMPRESSIONS_METRIC,
  );
  if (
    !total ||
    total.value === null ||
    total.propertyId !== part.propertyId ||
    total.from !== part.from ||
    total.to !== part.to ||
    new Date(total.observedAt).getTime() !== new Date(part.observedAt).getTime()
  )
    return null;
  const listed = part.rows.reduce((sum, row) => sum + row.impressions, 0);
  const hidden = total.value - listed;
  return hidden < 0 ? null : { total: total.value, listed, hidden };
}

export const SEO_POSITION_BUCKETS = ["top3", "top10", "top20", "rest"] as const;
export type SeoPositionBucket = (typeof SEO_POSITION_BUCKETS)[number];

/** Average positions are means, so round first: 3.4 counts as top 3, 3.5 as 4-10. */
function positionBucket(position: number): SeoPositionBucket {
  const rounded = Math.round(position);
  if (rounded <= 3) return "top3";
  if (rounded <= 10) return "top10";
  if (rounded <= 20) return "top20";
  return "rest";
}

type Totals = { clicks: number; impressions: number; weighted: number };

function sum(rows: QueryRow[]): Totals {
  const totals = { clicks: 0, impressions: 0, weighted: 0 };
  for (const row of rows) {
    totals.clicks += row.clicks;
    totals.impressions += row.impressions;
    totals.weighted += row.averagePosition * row.impressions;
  }
  return totals;
}

/** Position is weighted by impressions; with 0 impressions there is no rate. */
function rates({ clicks, impressions, weighted }: Totals) {
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    averagePosition: impressions ? weighted / impressions : null,
  };
}

export type SeoTopPage = ReturnType<typeof rates> & {
  pageUrl: string;
  queries: number;
  topQuery: string;
};

/** Query rows grouped by page, most clicks first. */
export function topPages(rows: QueryRow[]): SeoTopPage[] {
  const byPage = Map.groupBy(rows, (row) => row.pageUrl);
  return [...byPage]
    .map(([pageUrl, pageRows]) => {
      const top = pageRows.reduce((best, row) =>
        row.impressions > best.impressions ||
        (row.impressions === best.impressions && row.clicks > best.clicks)
          ? row
          : best,
      );
      return {
        pageUrl,
        ...rates(sum(pageRows)),
        queries: pageRows.length,
        topQuery: top.query,
      };
    })
    .sort(
      (a, b) =>
        b.clicks - a.clicks ||
        b.impressions - a.impressions ||
        a.pageUrl.localeCompare(b.pageUrl),
    );
}

/** Core matches tracked keywords with the same rule, so both sides agree on one key. */
export const normalizeQuery = normalizeSeoQuery;

const DAY_MS = 86_400_000;

export type SeoKeywordTrend =
  /** Statistics saved before daily positions existed: nothing to say per keyword. */
  | { state: "absent" }
  /** The last sync did not ask for this keyword (tracked later, or over the limit). */
  | { state: "not_requested" }
  /** Asked for, but Google listed no impressions for it in the period. */
  | { state: "empty" }
  | { state: "measured"; points: { date: string; value: number | null }[] };

/**
 * One tracked keyword's daily average position from the last Search Console sync.
 * Days run from the read's first day to the last day Google reported for any
 * tracked keyword; a day without impressions is a gap, never a zero.
 */
export function keywordTrend(
  queries: ProjectSeoWorkspace["searchQueries"],
  keyword: string,
  countryCode: string,
): SeoKeywordTrend {
  const series = queries?.keywordSeries;
  if (!queries || !series) return { state: "absent" };
  const key = normalizeQuery(keyword);
  // Older reads had no country filter; each newer entry belongs to one country.
  const entry = series.keywords.find(
    (item) =>
      item.keyword === key &&
      (!item.countryCode || item.countryCode === countryCode),
  );
  if (!entry) return { state: "not_requested" };
  if (!entry.points.length) return { state: "empty" };
  const last = series.keywords
    .flatMap((item) => item.points.map((point) => point.date))
    .reduce((latest, date) => (date > latest ? date : latest));
  const byDate = new Map(
    entry.points.map((point) => [point.date, point.position]),
  );
  const points: { date: string; value: number | null }[] = [];
  for (
    let day = Date.parse(`${queries.from}T00:00:00Z`);
    day <= Date.parse(`${last}T00:00:00Z`);
    day += DAY_MS
  ) {
    const date = new Date(day).toISOString().slice(0, 10);
    points.push({ date, value: byDate.get(date) ?? null });
  }
  return { state: "measured", points };
}

/**
 * Search Console rows summed per normalized query, over every page and country.
 * Rows are grouped by query and page, so each entry is a period average, not a live rank.
 */
export function searchConsoleIndex(rows: QueryRow[]) {
  const byQuery = Map.groupBy(rows, (row) => normalizeQuery(row.query));
  return new Map(
    [...byQuery].map(([query, matches]) => {
      const { clicks, impressions, averagePosition } = rates(sum(matches));
      return [query, { clicks, impressions, averagePosition }] as const;
    }),
  );
}

/** Each query counts once, at its impression-weighted position over all its pages. */
export function positionBuckets(rows: QueryRow[]) {
  const counts: Record<SeoPositionBucket, number> = {
    top3: 0,
    top10: 0,
    top20: 0,
    rest: 0,
  };
  for (const { averagePosition } of searchConsoleIndex(rows).values())
    if (averagePosition !== null) counts[positionBucket(averagePosition)] += 1;
  return counts;
}

export type SeoQuerySortKey =
  | "clicks"
  | "impressions"
  | "ctr"
  | "averagePosition";
export type SeoQuerySort = { key: SeoQuerySortKey; ascending: boolean };
export const SEO_DEFAULT_QUERY_SORT: SeoQuerySort = {
  key: "impressions",
  ascending: false,
};

/** First click shows the best rows: most clicks, or the lowest position. */
export function nextQuerySort(
  current: SeoQuerySort,
  key: SeoQuerySortKey,
): SeoQuerySort {
  if (current.key === key) return { key, ascending: !current.ascending };
  return { key, ascending: key === "averagePosition" };
}

/** The most searches the empty tracked list offers; the Traffic tab lists every search. */
export const SEO_KEYWORD_SUGGESTION_LIMIT = 5;

/**
 * Search Console searches to track first, most shown first. A search that
 * shows several pages is offered once, for its page with the most impressions.
 */
export function keywordSuggestions<Row extends QueryRow>(rows: Row[]) {
  const best = new Map<string, Row>();
  for (const row of rows) {
    const key = normalizeQuery(row.query);
    const current = best.get(key);
    if (!current || row.impressions > current.impressions) best.set(key, row);
  }
  return sortQueryRows([...best.values()], SEO_DEFAULT_QUERY_SORT);
}

export function sortQueryRows<Row extends QueryRow>(
  rows: Row[],
  { key, ascending }: SeoQuerySort,
) {
  return rows.toSorted(
    (a, b) =>
      (ascending ? a[key] - b[key] : b[key] - a[key]) ||
      b.impressions - a.impressions ||
      a.query.localeCompare(b.query),
  );
}
