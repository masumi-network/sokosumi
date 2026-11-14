import type { ProjectSeoMetric } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  hiddenImpressions,
  keywordSuggestions,
  keywordTrend,
  nextQuerySort,
  normalizeQuery,
  positionBuckets,
  SEO_DEFAULT_QUERY_SORT,
  searchConsoleIndex,
  sortQueryRows,
  topPages,
} from "./seo-search-model";
import { seoTestWorkspace } from "./seo-test-fixture";

const OBSERVED_AT = new Date("2026-11-01T12:00:00.000Z");
const PROPERTY = "sc-domain:example.com";

function row(
  query: string,
  pageUrl: string,
  clicks: number,
  impressions: number,
  averagePosition: number,
) {
  return {
    id: `${query}:${pageUrl}`,
    query,
    pageUrl,
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    averagePosition,
  };
}

function metric(overrides: Partial<ProjectSeoMetric> = {}): ProjectSeoMetric {
  return {
    id: "observation:impressions",
    key: "impressions",
    label: "Impressions",
    unit: "count",
    source: "search_console",
    propertyId: PROPERTY,
    value: 100,
    from: "2026-10-01",
    to: "2026-10-28",
    timeZone: "UTC",
    channel: "all",
    observedAt: OBSERVED_AT,
    coverage: "complete",
    points: [],
    notes: [],
    ...overrides,
  };
}

function workspaceWith(
  rows: ReturnType<typeof row>[],
  metrics: ProjectSeoMetric[],
  truncated = false,
) {
  const workspace = seoTestWorkspace();
  workspace.metrics = metrics;
  workspace.searchQueries = {
    observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
    propertyId: PROPERTY,
    from: "2026-10-01",
    to: "2026-10-28",
    timeZone: "UTC",
    observedAt: OBSERVED_AT,
    rowLimit: 250,
    truncated,
    rows,
  };
  return workspace;
}

const rows = [
  row("stablecoin", "https://example.com/", 3, 30, 2),
  row("usdc", "https://example.com/", 1, 10, 6),
];

describe("hiddenImpressions", () => {
  it("returns the impressions Google listed under no query", () => {
    expect(hiddenImpressions(workspaceWith(rows, [metric()]))).toEqual({
      total: 100,
      listed: 40,
      hidden: 60,
    });
  });

  it.each([
    ["another sync time", { observedAt: new Date("2026-11-02T12:00:00.000Z") }],
    ["another period", { from: "2026-09-01" }],
    ["another property", { propertyId: "sc-domain:other.example" }],
    ["no measured total", { value: null }],
  ] as [string, Partial<ProjectSeoMetric>][])(
    "returns null for a total from %s",
    (_, overrides) => {
      expect(
        hiddenImpressions(workspaceWith(rows, [metric(overrides)])),
      ).toBeNull();
    },
  );

  it("counts impressions a country split leaves out", () => {
    const workspace = workspaceWith(rows, [metric({ value: 35 })]);
    if (!workspace.searchQueries) throw new Error("Queries missing");
    const countries = {
      ...workspace.searchQueries,
      truncated: false,
      rows: [
        { key: "EG", clicks: 0, impressions: 1, ctr: 0, averagePosition: 3 },
      ],
    };
    expect(hiddenImpressions(workspace, countries)).toEqual({
      total: 35,
      listed: 1,
      hidden: 34,
    });
    expect(hiddenImpressions(workspace, null)).toBeNull();
  });

  it("returns null when rows add up to more than the total", () => {
    expect(
      hiddenImpressions(workspaceWith(rows, [metric({ value: 39 })])),
    ).toBeNull();
  });

  it("returns null when the rows were cut at the row limit", () => {
    expect(hiddenImpressions(workspaceWith(rows, [metric()], true))).toBeNull();
  });

  it("returns null without a Search Console impressions total", () => {
    expect(
      hiddenImpressions(
        workspaceWith(rows, [
          metric({ key: "clicks" }),
          metric({ source: "ga4" }),
        ]),
      ),
    ).toBeNull();
  });
});

describe("positionBuckets", () => {
  it("counts rounded average positions at each bucket edge", () => {
    expect(
      positionBuckets([
        row("a", "https://example.com/", 0, 1, 1),
        row("b", "https://example.com/", 0, 1, 3.4),
        row("c", "https://example.com/", 0, 1, 3.5),
        row("d", "https://example.com/", 0, 1, 10.4),
        row("e", "https://example.com/", 0, 1, 20),
        row("f", "https://example.com/", 0, 1, 20.5),
      ]),
    ).toEqual({ top3: 2, top10: 2, top20: 1, rest: 1 });
  });

  it("counts a query ranking on two pages once, at its weighted position", () => {
    expect(
      positionBuckets([
        row("usdc", "https://example.com/a", 0, 30, 2),
        row("USDC", "https://example.com/b", 0, 10, 15),
      ]),
    ).toEqual({ top3: 0, top10: 1, top20: 0, rest: 0 });
  });
});

describe("topPages", () => {
  it("weights position by impressions and picks the top query", () => {
    const [page] = topPages(rows);
    expect(page).toEqual({
      pageUrl: "https://example.com/",
      clicks: 4,
      impressions: 40,
      ctr: 0.1,
      averagePosition: 3,
      queries: 2,
      topQuery: "stablecoin",
    });
  });

  it("keeps rates missing for a page with 0 impressions", () => {
    const [page] = topPages([row("a", "https://example.com/a", 0, 0, 4)]);
    expect(page.ctr).toBeNull();
    expect(page.averagePosition).toBeNull();
  });

  it("sorts by clicks, then impressions, and breaks a top query tie by clicks", () => {
    const pages = topPages([
      row("x", "https://example.com/a", 1, 5, 2),
      row("y", "https://example.com/b", 1, 9, 2),
      row("low clicks", "https://example.com/c", 0, 50, 2),
      row("more clicks", "https://example.com/c", 2, 50, 2),
    ]);
    expect(pages.map((page) => page.pageUrl)).toEqual([
      "https://example.com/c",
      "https://example.com/b",
      "https://example.com/a",
    ]);
    expect(pages[0].topQuery).toBe("more clicks");
  });
});

describe("searchConsoleIndex", () => {
  it("normalizes case, spacing and full-width letters", () => {
    expect(normalizeQuery("  Stable\u00a0  COINS ")).toBe("stable coins");
    expect(normalizeQuery("\uff35\uff33\uff24\uff23")).toBe("usdc");
  });

  it("sums matching rows over pages with an impression-weighted position", () => {
    expect(
      searchConsoleIndex([
        row("best stablecoin", "https://example.com/", 1, 30, 2),
        row("BEST STABLECOIN", "https://example.com/b", 0, 10, 6),
        row("stablecoin", "https://example.com/", 5, 100, 1),
      ]).get(normalizeQuery("Best  Stablecoin")),
    ).toEqual({ clicks: 1, impressions: 40, averagePosition: 3 });
  });

  it("has no entry without a matching row", () => {
    expect(searchConsoleIndex(rows).get("usdt")).toBeUndefined();
  });
});

describe("query sort", () => {
  it("shows the best rows first on a new column and flips on a second click", () => {
    const byPosition = nextQuerySort(SEO_DEFAULT_QUERY_SORT, "averagePosition");
    expect(byPosition).toEqual({ key: "averagePosition", ascending: true });
    expect(nextQuerySort(byPosition, "averagePosition").ascending).toBe(false);
    expect(nextQuerySort(byPosition, "clicks")).toEqual({
      key: "clicks",
      ascending: false,
    });
  });

  it("breaks ties by impressions, then by query", () => {
    const sorted = sortQueryRows(
      [
        row("b", "https://example.com/", 1, 5, 2),
        row("a", "https://example.com/", 1, 5, 2),
        row("c", "https://example.com/", 1, 9, 2),
      ],
      { key: "clicks", ascending: false },
    );
    expect(sorted.map((item) => item.query)).toEqual(["c", "a", "b"]);
  });
});

describe("keyword suggestions", () => {
  it("offers each search once, for its most shown page, most shown first", () => {
    const offered = keywordSuggestions([
      row("solar battery", "https://example.com/a", 0, 3, 8),
      row("Solar  Battery", "https://example.com/b", 1, 9, 4),
      row("solar battery", "https://example.com/c", 0, 5, 6),
      row("inverter", "https://example.com/a", 0, 20, 12),
    ]);
    expect(offered.map((item) => [item.query, item.pageUrl])).toEqual([
      ["inverter", "https://example.com/a"],
      ["Solar  Battery", "https://example.com/b"],
    ]);
  });
});

describe("keyword trend", () => {
  const point = (
    date: string,
    impressions: number,
    position: number | null,
  ) => ({
    date,
    clicks: 0,
    impressions,
    position,
  });
  function seriesWorkspace() {
    const workspace = workspaceWith(rows, []);
    if (!workspace.searchQueries) throw new Error("fixture");
    workspace.searchQueries.keywordSeries = {
      rowLimit: 10_000,
      truncated: false,
      keywords: [
        {
          keyword: "usdc",
          points: [point("2026-10-01", 4, 6.5), point("2026-10-03", 0, null)],
        },
        { keyword: "stablecoin", points: [point("2026-10-04", 2, 3)] },
        { keyword: "eurc", points: [] },
      ],
    };
    return workspace.searchQueries;
  }

  it("fills missing days with gaps up to the last day Google reported", () => {
    expect(keywordTrend(seriesWorkspace(), "  USDC ", "US")).toEqual({
      state: "measured",
      points: [
        { date: "2026-10-01", value: 6.5 },
        { date: "2026-10-02", value: null },
        { date: "2026-10-03", value: null },
        { date: "2026-10-04", value: null },
      ],
    });
  });

  it("tells an unrequested keyword from one without impressions", () => {
    const queries = seriesWorkspace();
    expect(keywordTrend(queries, "EURC", "US")).toEqual({ state: "empty" });
    expect(keywordTrend(queries, "usdt", "US")).toEqual({
      state: "not_requested",
    });
    queries.keywordSeries = undefined;
    expect(keywordTrend(queries, "usdc", "US")).toEqual({ state: "absent" });
  });

  it("uses only the read of the keyword's own country", () => {
    const queries = seriesWorkspace();
    if (!queries?.keywordSeries) throw new Error("fixture");
    queries.keywordSeries.keywords = [
      {
        keyword: "eurc",
        countryCode: "DE",
        points: [point("2026-10-01", 1, 4)],
      },
      { keyword: "eurc", countryCode: "US", points: [] },
    ];
    expect(keywordTrend(queries, "eurc", "US")).toEqual({ state: "empty" });
    expect(keywordTrend(queries, "eurc", "FR")).toEqual({
      state: "not_requested",
    });
  });
});
