import type { ProjectSeoMetric } from "@sokosumi/core-client";
import {
  SEO_STATISTICS_QUERY_FAILED_NOTE,
  SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  latestSeoMeasurements,
  savedSeoStatistics,
  seoChangeMarkers,
  seoCheckPeriod,
  seoCoverageIsNews,
  seoDatePreset,
  seoDefaultMetric,
  seoMatchingProperty,
  seoQueryPeriod,
  seoSearchTraffic,
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
  });

  it("chooses the Search Console property that holds the page, and guesses nothing on a tie", () => {
    const property = (id: string, name = id) => ({ id, name });
    const page = "https://shop.example.com/boots";
    const choose = (ids: string[], url: string | undefined = page) =>
      seoMatchingProperty(
        "search_console",
        ids.map((id) => property(id)),
        url,
      );
    // One property needs no match.
    expect(choose(["sc-domain:other.org"])).toBe("sc-domain:other.org");
    // The domain property covers every address of the site: it beats the address prefix.
    expect(
      choose([
        "sc-domain:other.org",
        "https://shop.example.com/",
        "sc-domain:example.com",
      ]),
    ).toBe("sc-domain:example.com");
    // The closer domain wins, and "ample.com" is no parent of "example.com".
    expect(
      choose(["sc-domain:example.com", "sc-domain:shop.example.com"]),
    ).toBe("sc-domain:shop.example.com");
    expect(choose(["sc-domain:ample.com", "sc-domain:other.org"])).toBe("");
    // Without a domain property the longest address prefix that holds the page wins.
    expect(
      choose([
        "https://shop.example.com/",
        "https://shop.example.com/boots",
        "http://shop.example.com/",
      ]),
    ).toBe("https://shop.example.com/boots");
    expect(choose(["sc-domain:a.com", "sc-domain:b.com"], undefined)).toBe("");
  });

  it("chooses the one Google Analytics property that names the host", () => {
    const properties = [
      { id: "properties/1", name: "Blog" },
      { id: "properties/2", name: "Example.com shop" },
    ];
    const choose = (list = properties) =>
      seoMatchingProperty("ga4", list, "https://www.example.com/");
    expect(choose()).toBe("properties/2");
    expect(
      choose([...properties, { id: "properties/3", name: "example.com old" }]),
    ).toBe("");
    expect(choose([properties[0], { id: "properties/4", name: "App" }])).toBe(
      "",
    );
    // A name with a longer host is another site, not this one.
    for (const name of [
      "staging.example.com",
      "myexample.com",
      "example.com.au",
      "example.community",
    ])
      expect(choose([properties[0], { id: "properties/5", name }])).toBe("");
    expect(
      choose([properties[0], { id: "properties/6", name: "www.example.com." }]),
    ).toBe("properties/6");
    // "www." inside a name is part of the name.
    expect(
      seoMatchingProperty(
        "ga4",
        [properties[0], { id: "properties/7", name: "awww.com" }],
        "https://awww.com/",
      ),
    ).toBe("properties/7");
    // A page address with no host names no property, and the search for it ends.
    expect(seoMatchingProperty("ga4", properties, "https://www./")).toBe("");
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

  it.each([
    {
      from: "2026-01-01",
      to: "2026-01-02",
      beforeFrom: "2025-12-30",
      beforeTo: "2025-12-31",
      end: "2026-01-02",
    },
    // The requested end is not settled yet: the comparison retains only one current day.
    {
      from: "2026-01-01",
      to: "2026-01-04",
      beforeFrom: "2025-12-31",
      beforeTo: "2025-12-31",
      end: "2026-01-01",
    },
    // UTC calendar arithmetic keeps the leap day and crosses the month boundary.
    {
      from: "2024-02-28",
      to: "2024-03-02",
      beforeFrom: "2024-02-24",
      beforeTo: "2024-02-27",
      end: "2024-03-02",
    },
  ])(
    "retains the settled endpoint $end for a quiet period from $from to $to",
    ({ from, to, beforeFrom, beforeTo, end }) => {
      const clicks = metric({
        id: "sync-a:clicks",
        key: "clicks",
        source: "search_console",
        from,
        to,
        points: [{ date: from, value: 2 }],
        previous: { from: beforeFrom, to: beforeTo, value: 3 },
      });
      const metrics = [
        clicks,
        { ...clicks, id: "sync-a:impressions", key: "impressions", value: 20 },
      ];
      const period = { from, to: end };
      expect(
        seoQueryPeriod({ observationId: "sync-a", from, to }, metrics),
      ).toEqual(period);
      expect(seoSearchTraffic(metrics)?.period).toEqual(period);
    },
  );
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

describe("seoChangeMarkers", () => {
  const item = (kind: "page_change" | "check", at: string, title: string) => ({
    id: title,
    kind,
    title,
    at: new Date(at),
    pageIds: [],
    observationId: null,
    taskId: null,
    status: "recorded",
    detail: "",
  });

  it("marks recorded page changes on their day in the metric's time zone", () => {
    const timeline = [
      item("page_change", "2026-10-05T03:00:00Z", "New title"),
      item("check", "2026-10-05T03:00:00Z", "Check finished"),
    ];
    // 03:00 UTC is still the evening before in California.
    expect(seoChangeMarkers(timeline, "America/Los_Angeles")).toEqual([
      { date: "2026-10-04", label: "New title" },
    ]);
    expect(seoChangeMarkers(timeline, "not_determined")).toEqual([
      { date: "2026-10-05", label: "New title" },
    ]);
  });
});

describe("seoDatePreset", () => {
  const now = new Date("2026-11-13T10:00:00Z");

  it("names the quick choice a period is, ending today", () => {
    expect(seoDatePreset({ from: "2026-10-17", to: "2026-11-13" }, now)).toBe(
      28,
    );
    expect(seoDatePreset({ from: "2026-11-07", to: "2026-11-13" }, now)).toBe(
      7,
    );
    // A sync's period ends yesterday; a quick choice of checks keeps today's check in view.
    expect(seoCheckPeriod(7, now)).toEqual({
      from: "2026-11-07",
      to: "2026-11-13",
    });
  });

  it("gives null for a typed period, an open end, or a quick choice of an earlier day", () => {
    expect(seoDatePreset({ from: "2026-10-16", to: "2026-11-13" }, now)).toBe(
      null,
    );
    expect(seoDatePreset({ from: "2026-11-07", to: null }, now)).toBe(null);
    // Chosen yesterday: today it covers other days, so no button shows it as chosen.
    expect(seoDatePreset({ from: "2026-11-06", to: "2026-11-12" }, now)).toBe(
      null,
    );
  });
});
