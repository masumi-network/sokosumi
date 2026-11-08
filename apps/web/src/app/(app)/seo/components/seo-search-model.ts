import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { latestSeoMeasurements } from "./seo-statistics-model";

type QueryRow = Omit<
  NonNullable<ProjectSeoWorkspace["searchQueries"]>["rows"][number],
  "id"
>;

const IMPRESSIONS_METRIC = "impressions";

/**
 * Impressions Google counted for the pages but listed under no query.
 * Null when the total and the rows cannot be proved to come from one sync,
 * when the rows were cut at the row limit, or when the numbers disagree.
 */
export function hiddenImpressions(workspace: ProjectSeoWorkspace) {
  const queries = workspace.searchQueries;
  if (!queries || queries.truncated) return null;
  const total = latestSeoMeasurements(workspace.metrics).find(
    (metric) =>
      metric.source === "search_console" && metric.key === IMPRESSIONS_METRIC,
  );
  if (
    !total ||
    total.value === null ||
    total.propertyId !== queries.propertyId ||
    total.from !== queries.from ||
    total.to !== queries.to ||
    new Date(total.observedAt).getTime() !==
      new Date(queries.observedAt).getTime()
  )
    return null;
  const listed = queries.rows.reduce((sum, row) => sum + row.impressions, 0);
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

export function normalizeQuery(text: string) {
  return text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
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
