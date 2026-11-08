import type { ProjectSeoMetric } from "@sokosumi/core-client";
import {
  SEO_STATISTICS_QUERY_FAILED_NOTE,
  SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  invalidSeoStatisticsPeriod,
  latestSeoMeasurements,
  savedSeoStatistics,
  seoCoverageIsNews,
  seoDefaultMetric,
  seoQueryPeriod,
  seoStatisticsPeriod,
} from "./seo-statistics-model";

function metric(change: Partial<ProjectSeoMetric> = {}): ProjectSeoMetric {
  return {
    id: "views",
    key: "page_views",
    label: "Page views",
    unit: "count",
    source: "ga4",
    propertyId: "properties/123",
    value: 100,
    from: "2026-10-01",
    to: "2026-10-28",
    timeZone: "UTC",
    channel: "all",
    observedAt: new Date("2026-10-29T10:00:00Z"),
    coverage: "complete",
    points: [],
    notes: [],
    ...change,
  };
}

describe("SEO statistics presentation", () => {
  it("keeps one source snapshot without mixing old periods, properties or organic totals", () => {
    const latest = metric();
    const users = metric({ id: "users", key: "active_users" });
    const otherSource = metric({
      id: "clicks",
      source: "search_console",
      propertyId: "sc-domain:example.com",
    });
    expect(
      latestSeoMeasurements([
        metric({
          id: "old-period",
          observedAt: new Date("2026-10-28T10:00:00Z"),
          from: "2026-09-01",
        }),
        latest,
        users,
        otherSource,
        metric({ id: "other-property", propertyId: "properties/456" }),
        metric({ id: "organic", channel: "organic" }),
      ]).map((item) => item.id),
    ).toEqual(["views", "users", "clicks"]);
    expect(savedSeoStatistics([latest])).toMatchObject({
      source: "ga4",
      propertyId: "properties/123",
    });
  });

  it("returns complete UTC days across month and leap-day boundaries", () => {
    expect(seoStatisticsPeriod(7, new Date("2024-03-02T00:01:00Z"))).toEqual({
      from: "2024-02-24",
      to: "2024-03-01",
    });
    expect(invalidSeoStatisticsPeriod("2026-11-05", "2026-11-04")).toBe(true);
    expect(invalidSeoStatisticsPeriod("bad-date", "2026-11-04")).toBe(true);
    expect(invalidSeoStatisticsPeriod("2026-11-04", "2026-11-04")).toBe(false);
  });
});

describe("seoCoverageIsNews", () => {
  // A healthy Search Console sync as Core stores it: two notes, no loss.
  const usual = [
    "Search Console final data can omit recent dates and privacy-filtered observations.",
    "Query rows omit anonymized queries, so they can add up to less than the page totals.",
  ];
  const sync = (source: string, coverage: string, notes = usual) => ({
    source,
    coverage,
    notes,
  });
  it("flags a lost Search Console query and any other source's gap, not Google's usual filtering", () => {
    expect(seoCoverageIsNews(sync("search_console", "partial"))).toBe(false);
    for (const lost of [
      SEO_STATISTICS_QUERY_FAILED_NOTE,
      SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE,
    ])
      expect(
        seoCoverageIsNews(sync("search_console", "partial", [usual[0], lost])),
      ).toBe(true);
    expect(seoCoverageIsNews(sync("ga4", "partial", []))).toBe(true);
    expect(seoCoverageIsNews(sync("search_console", "unavailable"))).toBe(true);
    expect(seoCoverageIsNews(sync("ga4", "complete", []))).toBe(false);
  });
});

describe("seoQueryPeriod", () => {
  const source = {
    observationId: "sync-a",
    from: "2026-10-11",
    to: "2026-11-07",
  };
  const search = (sync: string) =>
    metric({
      id: `${sync}:clicks`,
      source: "search_console",
      from: source.from,
      to: source.to,
      points: [
        // Google left out the quiet first days; the rows still start on the requested day.
        { date: "2026-10-13", value: 1 },
        { date: "2026-11-06", value: 0 },
        { date: "2026-11-07", value: null },
      ],
    });

  it("ends the rows' period on the last day Google reported for the same read", () => {
    expect(seoQueryPeriod(source, [search("sync-a")])).toEqual({
      from: source.from,
      to: "2026-11-06",
    });
  });

  it("keeps the requested period when the saved totals come from another read", () => {
    expect(seoQueryPeriod(source, [search("sync-b")])).toEqual({
      from: source.from,
      to: source.to,
    });
  });
});

describe("seoDefaultMetric", () => {
  const points = (values: (number | null)[]) =>
    values.map((value, day) => ({ date: `2026-10-1${day}`, value }));

  it("opens on the count with the most days above zero", () => {
    const clicks = metric({ id: "clicks", points: points([1, 0, 0, 1]) });
    const impressions = metric({
      id: "impressions",
      points: points([3, 2, 0, 5]),
    });
    const position = metric({
      id: "position",
      unit: "position",
      points: points([2, 3, 4, 5]),
    });
    expect(seoDefaultMetric([clicks, impressions, position]).id).toBe(
      "impressions",
    );
  });

  it("keeps the first count when counts tie, and the first metric without counts", () => {
    const clicks = metric({ id: "clicks", points: points([1]) });
    const impressions = metric({ id: "impressions", points: points([4]) });
    expect(seoDefaultMetric([clicks, impressions]).id).toBe("clicks");
    const ratio = metric({ id: "ctr", unit: "ratio" });
    expect(seoDefaultMetric([ratio]).id).toBe("ctr");
  });
});
