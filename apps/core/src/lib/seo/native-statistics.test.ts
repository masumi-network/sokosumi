import { describe, expect, it } from "vitest";

import {
  bindSeoToolArguments,
  ga4StatisticsArguments,
  gscStatisticsArguments,
  type NativeStatisticsQuery,
  normalizeGa4Statistics,
  normalizeGscStatistics,
  SEO_STATS_PAYLOAD_LIMIT,
  unwrapNativeStatistics,
} from "./native-statistics";

const query: NativeStatisticsQuery = {
  provider: "ga4",
  propertyId: "properties/123",
  pageUrls: ["https://example.com/a", "https://example.com/b"],
  from: "2026-01-01",
  to: "2026-01-02",
  channel: "all",
};
const names = [
  "screenPageViews",
  "activeUsers",
  "sessions",
  "userEngagementDuration",
];
function ga4(values: string[][], dates?: string[]) {
  return {
    dimensionHeaders: dates ? [{ name: "date" }] : [],
    metricHeaders: names.map((name) => ({ name })),
    rows: values.map((row, index) => ({
      metricValues: row.map((value) => ({ value })),
      dimensionValues: dates ? [{ value: dates[index] }] : [],
    })),
    rowCount: values.length,
    metadata: { timeZone: "Europe/Oslo" },
  };
}

describe("native SEO statistics", () => {
  it("unwraps native JSON text but refuses failed or oversized response envelopes", () => {
    const payload = { metricHeaders: [{ name: "screenPageViews" }], rows: [] };
    expect(
      unwrapNativeStatistics(JSON.stringify(payload), ["metricHeaders"]),
    ).toEqual(payload);
    expect(
      unwrapNativeStatistics(
        { successful: true, data: JSON.stringify(payload) },
        ["metricHeaders"],
      ),
    ).toEqual(payload);
    expect(() =>
      unwrapNativeStatistics({ successful: false, data: payload }, [
        "metricHeaders",
      ]),
    ).toThrow("query failed");
    expect(() =>
      unwrapNativeStatistics({ error: "provider failed", ...payload }, [
        "metricHeaders",
      ]),
    ).toThrow("query failed");
    expect(() =>
      unwrapNativeStatistics({ data: "x".repeat(SEO_STATS_PAYLOAD_LIMIT) }, [
        "metricHeaders",
      ]),
    ).toThrow("exceeded its limit");
  });
  it("uses the native period total for distinct users instead of adding daily users", () => {
    const result = normalizeGa4Statistics(
      query,
      ga4([["60", "24", "30", "1200"]]),
      ga4(
        [
          ["30", "15", "15", "600"],
          ["30", "15", "15", "600"],
        ],
        ["20260101", "20260102"],
      ),
      "2026-01-03T00:00:00.000Z",
    );
    expect(
      result.metrics.find((metric) => metric.key === "active_users"),
    ).toMatchObject({
      value: 24,
      points: [
        { date: "2026-01-01", value: 15 },
        { date: "2026-01-02", value: 15 },
      ],
    });
    expect(
      result.metrics.find((metric) => metric.key === "page_views")?.value,
    ).toBe(60);
    expect(result.timeZone).toBe("Europe/Oslo");
  });

  it("keeps absent rows unavailable but preserves an explicitly reported zero", () => {
    expect(
      normalizeGa4Statistics(
        query,
        ga4([]),
        ga4([], []),
        "2026-01-03T00:00:00.000Z",
      ).metrics.every((metric) => metric.value === null),
    ).toBe(true);
    expect(
      normalizeGa4Statistics(
        query,
        ga4([["0", "0", "0", "0"]]),
        ga4([], []),
        "2026-01-03T00:00:00.000Z",
      ).metrics[0].value,
    ).toBe(0);
  });

  it("retains a successful daily read when the aggregate query fails without inventing a total", () => {
    const result = normalizeGa4Statistics(
      query,
      null,
      ga4([["3", "2", "2", "50"]], ["20260101"]),
      "2026-01-03T00:00:00.000Z",
    );
    expect(result.coverage).toBe("partial");
    expect(result.metrics[0]).toMatchObject({
      value: null,
      points: [{ date: "2026-01-01", value: 3 }],
    });
    expect(result.notes.join(" ")).toContain("One native query failed");
    const malformed = ga4([["", "2", "2", "50"]]);
    expect(() =>
      normalizeGa4Statistics(
        query,
        malformed,
        ga4([], []),
        "2026-01-03T00:00:00.000Z",
      ),
    ).toThrow();
  });

  it("refuses mismatched metric definitions, duplicate dates and out-of-period observations", () => {
    const wrong = ga4([["1", "1", "1", "1"]]);
    wrong.metricHeaders[0].name = "sessions";
    expect(() =>
      normalizeGa4Statistics(
        query,
        wrong,
        ga4([], []),
        "2026-01-03T00:00:00.000Z",
      ),
    ).toThrow("different metric definitions");
    expect(() =>
      normalizeGa4Statistics(
        query,
        ga4([["1", "1", "1", "1"]]),
        ga4(
          [
            ["1", "1", "1", "1"],
            ["1", "1", "1", "1"],
          ],
          ["20260101", "20260101"],
        ),
        "2026-01-03T00:00:00.000Z",
      ),
    ).toThrow("duplicate dates");
    expect(() =>
      normalizeGa4Statistics(
        query,
        ga4([["1", "1", "1", "1"]]),
        ga4([["1", "1", "1", "1"]], ["20251231"]),
        "2026-01-03T00:00:00.000Z",
      ),
    ).toThrow("outside the selected period");
    expect(() =>
      normalizeGa4Statistics(
        { ...query, from: "2026-01-01", to: "2026-12-31" },
        ga4([["1", "1", "1", "1"]]),
        ga4([["1", "1", "1", "1"]], ["20260231"]),
        "2026-01-03T00:00:00.000Z",
      ),
    ).toThrow("outside the selected period");
  });

  it("keeps Search Console weighted period position instead of averaging daily positions", () => {
    const totals = {
      rows: [{ clicks: 2, impressions: 100, ctr: 0.02, position: 3.2 }],
    };
    const daily = {
      rows: [
        {
          keys: ["2026-01-01"],
          clicks: 1,
          impressions: 90,
          ctr: 1 / 90,
          position: 3,
        },
        {
          keys: ["2026-01-02"],
          clicks: 1,
          impressions: 10,
          ctr: 0.1,
          position: 5,
        },
      ],
    };
    const result = normalizeGscStatistics(
      { ...query, provider: "search_console" },
      totals,
      daily,
      "2026-01-03T00:00:00.000Z",
    );
    expect(
      result.metrics.find((metric) => metric.key === "position")?.value,
    ).toBe(3.2);
    expect(result.metrics.find((metric) => metric.key === "ctr")?.value).toBe(
      0.02,
    );
    expect(result.timeZone).toBe("America/Los_Angeles");
  });

  it("pins exact page filters and organic channel before a native query", () => {
    const args = ga4StatisticsArguments(
      { ...query, channel: "organic" },
      false,
    );
    expect(args.limit).toBe(400);
    expect(args).toMatchObject({
      property: "properties/123",
      dimensions: [],
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: "pageLocation",
                inListFilter: { values: query.pageUrls, caseSensitive: true },
              },
            },
            {
              filter: {
                fieldName: "sessionDefaultChannelGroup",
                stringFilter: { value: "Organic Search" },
              },
            },
          ],
        },
      },
    });
    expect(
      gscStatisticsArguments(
        { ...query, pageUrls: ["https://example.com/a?x=1"] },
        true,
      ),
    ).toMatchObject({
      dimension_filter_groups: [
        { filters: [{ expression: "^(?:https://example\\.com/a\\?x=1)$" }] },
      ],
    });
  });

  it("refuses a native tool that would drop the date or page scope", () => {
    const descriptor = {
      slug: "GOOGLE_ANALYTICS_RUN_REPORT",
      readOnly: true,
      inputSchema: {
        properties: { property: {}, date_ranges: {}, dimension_filter: {} },
        required: ["property", "date_ranges", "dimension_filter"],
      },
    };
    expect(
      bindSeoToolArguments(descriptor, {
        property: "properties/123",
        dateRanges: [],
        dimensionFilter: {},
      }),
    ).toEqual({
      property: "properties/123",
      date_ranges: [],
      dimension_filter: {},
    });
    expect(() =>
      bindSeoToolArguments(descriptor, {
        property: "properties/123",
        pageFilter: {},
      }),
    ).toThrow("does not support pageFilter");
    expect(() =>
      bindSeoToolArguments({ ...descriptor, readOnly: false }, {}),
    ).toThrow("read-only");
    expect(() =>
      bindSeoToolArguments(descriptor, { property: "properties/123" }),
    ).toThrow("unsupported arguments");
  });
});
