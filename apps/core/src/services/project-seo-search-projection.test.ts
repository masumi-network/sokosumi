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
  extra: {
    propertyId?: string;
    truncated?: boolean;
    position?: number;
    collectedAt?: string;
    pageUrls?: string[];
  } = {},
): SearchEvidenceSource {
  return {
    row: { observedAt: new Date("2026-03-11T00:00:00Z") },
    data: {
      collectedAt: extra.collectedAt,
      pageUrls: extra.pageUrls ?? ["https://example.com/"],
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

  it("adds the older days of an earlier sync whose last 3 days are read again", () => {
    const earlier = sync("2026-02-10", "2026-03-03", [
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

  it("counts an earlier sync as read only up to the day it was collected", () => {
    // Collected on Feb 20 with a period to Mar 3: Feb 21 to 28 were never read.
    const earlier = sync(
      "2026-02-10",
      "2026-03-03",
      [["battery", "US", ["2026-02-10", "2026-02-19"]]],
      { collectedAt: "2026-02-20T08:00:00.000Z" },
    );
    expect(merged(current, [earlier]).keywords).toEqual([
      { from: undefined, dates: ["2026-03-01", "2026-03-09"] },
    ]);
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
    const overlapping = sync("2026-02-15", "2026-03-03", [
      ["battery", "US", ["2026-02-16"]],
    ]);
    // It ends on 2026-02-16. Google can still change its last days, and no later sync reads 3 days
    // of it again, so this sync and all before it stay out.
    const openEnd = sync("2026-02-01", "2026-02-16", [
      ["battery", "US", ["2026-02-02"]],
    ]);
    expect(
      merged(current, [openEnd, overlapping, withoutKeyword]).keywords,
    ).toEqual([
      { from: "2026-02-15", dates: ["2026-02-16", "2026-03-01", "2026-03-09"] },
    ]);
    // One more day of overlap, and its days count as read.
    const closed = sync("2026-02-01", "2026-02-17", [
      ["battery", "US", ["2026-02-02"]],
    ]);
    expect(merged(current, [closed, overlapping]).keywords?.[0].from).toBe(
      "2026-02-01",
    );
  });

  it("takes a day of two syncs with one last day from the one collected later", () => {
    const replay = sync(
      "2026-02-10",
      "2026-03-05",
      [["battery", "US", ["2026-02-11"]]],
      { collectedAt: "2026-03-06T08:00:00.000Z", position: 9 },
    );
    const fresh = sync(
      "2026-02-10",
      "2026-03-05",
      [["battery", "US", ["2026-02-11", "2026-02-12"]]],
      { collectedAt: "2026-03-07T08:00:00.000Z", position: 2 },
    );
    for (const order of [
      [replay, fresh],
      [fresh, replay],
    ]) {
      const series = mergedKeywordSeries(current, [current, ...order]);
      expect(
        series?.keywords[0].points.map((item) => [item.date, item.position]),
      ).toEqual([
        ["2026-02-11", 2],
        ["2026-02-12", 2],
        ["2026-03-01", 5],
        ["2026-03-09", 5],
      ]);
    }
  });

  it("takes no days from another property, another country or a read without days before its own", () => {
    const others = [
      sync("2026-02-01", "2026-03-05", [["battery", "US", ["2026-02-02"]]], {
        propertyId: "sc-domain:other.example",
      }),
      sync("2026-02-01", "2026-03-05", [["battery", "DE", ["2026-02-03"]]]),
      sync("2026-02-01", "2026-03-05", [["battery", "US", ["2026-02-04"]]], {
        pageUrls: ["https://www.example.com/"],
      }),
      // It ends after this sync, so this sync never read its last days again.
      sync("2026-02-01", "2026-03-18", [["battery", "US", ["2026-02-05"]]]),
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
      "2026-03-03",
      [["battery", "US", ["2026-02-10"]]],
      { truncated: true },
    );
    expect(merged(current, [earlier]).truncated).toBe(true);
  });

  it("keeps at most 366 days", () => {
    // A sync covers at most 366 days.
    const earlier = sync("2025-03-05", "2026-03-05", [
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
