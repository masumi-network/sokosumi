import { describe, expect, it } from "vitest";

import {
  mergedKeywordSeries,
  type SearchEvidenceSource,
} from "./project-seo-search-projection";

type Entry = [keyword: string, countryCode: string, dates: string[]];

function point(date: string, position = 5) {
  return { date, clicks: 1, impressions: 10, position };
}

function sync(
  from: string,
  to: string,
  entries: Entry[],
  extra: { propertyId?: string; truncated?: boolean; position?: number } = {},
): SearchEvidenceSource {
  return {
    row: {},
    data: {
      propertyId: extra.propertyId ?? "sc-domain:example.com",
      from,
      to,
      keywordSeries: {
        rowLimit: 10_000,
        truncated: extra.truncated ?? false,
        keywords: entries.map(([keyword, countryCode, dates]) => ({
          keyword,
          countryCode,
          points: dates.map((date) => point(date, extra.position)),
        })),
      },
    },
  } as unknown as SearchEvidenceSource;
}

function merged(current: SearchEvidenceSource, older: SearchEvidenceSource[]) {
  const series = mergedKeywordSeries(current, [current, ...older]);
  return {
    truncated: series?.truncated,
    keywords: series?.keywords.map((entry) => ({
      from: entry.from,
      dates: entry.points.map((item) => item.date),
    })),
  };
}

describe("mergedKeywordSeries", () => {
  const current = sync("2026-03-01", "2026-03-10", [
    ["battery", "US", ["2026-03-01", "2026-03-09"]],
  ]);

  it("adds the older days of an earlier sync whose period touches the read days", () => {
    const earlier = sync("2026-02-10", "2026-02-28", [
      ["battery", "US", ["2026-02-10", "2026-02-27"]],
    ]);
    expect(merged(current, [earlier])).toEqual({
      truncated: false,
      keywords: [
        {
          from: "2026-02-10",
          dates: ["2026-02-10", "2026-02-27", "2026-03-01", "2026-03-09"],
        },
      ],
    });
  });

  it("keeps the newest read of a day both syncs cover", () => {
    const earlier = sync(
      "2026-02-20",
      "2026-03-05",
      [["battery", "US", ["2026-02-25", "2026-03-01", "2026-03-04"]]],
      { position: 9 },
    );
    const series = mergedKeywordSeries(current, [current, earlier]);
    expect(
      series?.keywords[0].points.map((item) => [item.date, item.position]),
    ).toEqual([
      ["2026-02-25", 9],
      ["2026-03-01", 5],
      ["2026-03-09", 5],
    ]);
  });

  it("stops at the first unread day and reads on through a sync without the keyword", () => {
    const withoutKeyword = sync("2026-02-20", "2026-03-05", [
      ["charger", "US", ["2026-02-21"]],
    ]);
    const touching = sync("2026-02-15", "2026-02-28", [
      ["battery", "US", ["2026-02-16"]],
    ]);
    // 2026-02-13 and 2026-02-14 were never read, so this sync and all before it stay out.
    const afterHole = sync("2026-02-01", "2026-02-12", [
      ["battery", "US", ["2026-02-02"]],
    ]);
    expect(
      merged(current, [afterHole, touching, withoutKeyword]).keywords,
    ).toEqual([
      { from: "2026-02-15", dates: ["2026-02-16", "2026-03-01", "2026-03-09"] },
    ]);
  });

  it("takes no days from another property, another country or a read without days before its own", () => {
    const others = [
      sync("2026-02-01", "2026-02-28", [["battery", "US", ["2026-02-02"]]], {
        propertyId: "sc-domain:other.example",
      }),
      sync("2026-02-01", "2026-02-28", [["battery", "DE", ["2026-02-03"]]]),
      sync("2026-03-02", "2026-03-08", [["battery", "US", ["2026-03-03"]]], {
        truncated: true,
      }),
    ];
    expect(merged(current, others)).toEqual({
      truncated: false,
      keywords: [{ from: undefined, dates: ["2026-03-01", "2026-03-09"] }],
    });
  });

  it("says the series is cut when a sync that added days was cut", () => {
    const earlier = sync(
      "2026-02-10",
      "2026-02-28",
      [["battery", "US", ["2026-02-10"]]],
      { truncated: true },
    );
    expect(merged(current, [earlier]).truncated).toBe(true);
  });

  it("keeps at most 366 days", () => {
    const earlier = sync("2025-01-01", "2026-02-28", [
      ["battery", "US", ["2025-03-09", "2025-03-10", "2026-02-01"]],
    ]);
    // 366 days end on 2026-03-10 and start on 2025-03-10.
    expect(merged(current, [earlier]).keywords).toEqual([
      {
        from: "2025-03-10",
        dates: ["2025-03-10", "2026-02-01", "2026-03-01", "2026-03-09"],
      },
    ]);
  });
});
