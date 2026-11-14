import { seoStatisticsKeywordsLeftOutNote } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  SEO_KEYWORD_SERIES_MAX_COUNTRIES,
  SEO_KEYWORD_SERIES_MAX_KEYWORDS,
  SEO_KEYWORD_SERIES_ROW_LIMIT,
  SEO_SEARCH_QUERY_ROW_LIMIT,
} from "@/schemas/project-seo.schema";
import {
  GSC_FILTER_EXPRESSION_LIMIT,
  gscKeywordSeriesArguments,
  gscQueryArguments,
  normalizeGscKeywordSeries,
  normalizeGscQueries,
  selectTrackedKeywords,
} from "./native-gsc-queries";
import { gscStatisticsArguments } from "./native-statistics";

const query = {
  provider: "search_console" as const,
  propertyId: "sc-domain:example.test",
  pageUrls: ["https://www.example.test/", "https://www.example.test/a"],
  from: "2026-10-09",
  to: "2026-11-05",
  channel: "organic" as const,
};
const row = (keys: string[], impressions = 10) => ({
  keys,
  clicks: 1,
  impressions,
  ctr: 0.1,
  position: 6.5,
});

describe("Search Console query rows", () => {
  it("reuses the exact page filter and dates of the totals", () => {
    const rows = gscQueryArguments(query),
      totals = gscStatisticsArguments(query, false);
    expect(rows.dimensions).toEqual(["query", "page"]);
    expect(rows.row_limit).toBe(SEO_SEARCH_QUERY_ROW_LIMIT);
    for (const key of [
      "site_url",
      "start_date",
      "end_date",
      "search_type",
      "data_state",
      "dimension_filter_groups",
    ])
      expect(rows[key]).toEqual(totals[key]);
  });

  it("normalizes rows without inventing volume, market or device", () => {
    const result = normalizeGscQueries(query, {
      rows: [row(["battery health", "https://www.example.test/"])],
    });
    expect(result).toEqual({
      rowLimit: SEO_SEARCH_QUERY_ROW_LIMIT,
      truncated: false,
      rows: [
        {
          query: "battery health",
          pageUrl: "https://www.example.test/",
          clicks: 1,
          impressions: 10,
          ctr: 0.1,
          averagePosition: 6.5,
        },
      ],
    });
  });

  it("accepts an empty response as zero rows", () => {
    expect(normalizeGscQueries(query, {}).rows).toEqual([]);
  });

  it("refuses rows outside the selected pages, other groupings and duplicates", () => {
    expect(() =>
      normalizeGscQueries(query, {
        rows: [row(["q", "https://www.example.test/other"])],
      }),
    ).toThrow("outside the selection");
    expect(() => normalizeGscQueries(query, { rows: [row(["q"])] })).toThrow(
      "different query grouping",
    );
    expect(() =>
      normalizeGscQueries(query, {
        rows: [
          row(["q", "https://www.example.test/a"]),
          row(["q", "https://www.example.test/a"]),
        ],
      }),
    ).toThrow("duplicate");
  });

  it("marks a full page as truncated because more rows can exist", () => {
    const rows = Array.from({ length: SEO_SEARCH_QUERY_ROW_LIMIT }, (_, i) =>
      row([`query ${i}`, "https://www.example.test/"]),
    );
    expect(normalizeGscQueries(query, { rows }).truncated).toBe(true);
  });
});

describe("tracked keyword daily rows", () => {
  const day = (
    date: string,
    text: string,
    impressions: number,
    position: number,
    clicks = 1,
  ) => ({ keys: [date, text], clicks, impressions, ctr: 0, position });

  it("adds an escaped keyword filter to the same page filter group", () => {
    const args = gscKeywordSeriesArguments(query, {
        countryCode: "DE",
        keywords: ["c++ guide", "A.b"],
      }),
      totals = gscStatisticsArguments(query, false);
    expect(args.dimensions).toEqual(["date", "query"]);
    expect(args.row_limit).toBe(SEO_KEYWORD_SERIES_ROW_LIMIT);
    for (const key of [
      "site_url",
      "start_date",
      "end_date",
      "search_type",
      "data_state",
    ])
      expect(args[key]).toEqual(totals[key]);
    const [pageGroup] = totals.dimension_filter_groups as Array<{
      filters: unknown[];
    }>;
    expect(args.dimension_filter_groups).toEqual([
      {
        groupType: "and",
        filters: [
          ...pageGroup.filters,
          {
            dimension: "query",
            operator: "includingRegex",
            expression: "(?i)^(?:c\\+\\+ guide|a\\.b)$",
          },
          // Searchers in the keyword's country only, in Google's alpha-3 code.
          { dimension: "country", operator: "equals", expression: "deu" },
        ],
      },
    ]);
  });

  it("chooses 25 saved keywords by priority and names the rest", () => {
    const keywords = Array.from({ length: 30 }, (_, i) => ({
      keyword: `kw ${String(i).padStart(2, "0")}`,
      saved: true,
      priority: (i === 29 ? "high" : "medium") as "high" | "medium",
      countryCode: "US",
      version: 1,
      source: "saved",
    }));
    const { groups, leftOut } = selectTrackedKeywords([
      ...keywords,
      {
        keyword: "KW  29",
        saved: true,
        priority: "low",
        countryCode: "US",
        version: 1,
        source: "saved",
      },
      {
        keyword: "unsaved",
        saved: false,
        priority: "high",
        countryCode: "US",
        version: 1,
        source: "saved",
      },
    ]);
    expect(groups).toHaveLength(1);
    const chosen = groups[0].keywords;
    expect(chosen).toHaveLength(25);
    expect(chosen.slice(0, 3)).toEqual(["kw 29", "kw 00", "kw 01"]);
    expect(leftOut).toEqual([
      "kw 24 (US)",
      "kw 25 (US)",
      "kw 26 (US)",
      "kw 27 (US)",
      "kw 28 (US)",
    ]);
    const note = seoStatisticsKeywordsLeftOutNote(
      leftOut,
      SEO_KEYWORD_SERIES_MAX_KEYWORDS,
      SEO_KEYWORD_SERIES_MAX_COUNTRIES,
    );
    expect(note).toContain(
      '"kw 24 (US)", "kw 25 (US)", "kw 26 (US)", "kw 27 (US)", "kw 28 (US)".',
    );
    expect(note).not.toMatch(/[–—]/);
  });

  it("reads the reader's own keywords before the keywords tracked from a check", () => {
    // A check tracks its keywords from the start, with no stored choice (version 0).
    const fromCheck = Array.from({ length: 26 }, (_, i) => ({
      keyword: `check ${String(i).padStart(2, "0")}`,
      saved: true,
      priority: "high" as const,
      countryCode: "US",
      version: 0,
      // The last one is a keyword the check set out to read; the others it found on the way.
      source: i === 25 ? "focus" : "ranked",
    }));
    const own = {
      keyword: "own",
      saved: true,
      priority: "low" as const,
      countryCode: "US",
      version: 2,
      source: "saved",
    };
    const { groups, leftOut } = selectTrackedKeywords([
      ...fromCheck,
      own,
      // The same keyword in a second language of the country, there without a choice: the choice holds.
      { ...own, keyword: "OWN", version: 0, source: "ranked" },
    ]);
    // The reader's keyword keeps its place, at the lowest priority and after 26 others.
    // Then the keyword the check set out to read, then the others by name.
    expect(groups[0].keywords.slice(0, 3)).toEqual([
      "own",
      "check 25",
      "check 00",
    ]);
    expect(groups[0].keywords).toHaveLength(25);
    // Two keywords of the check did not fit. The reader did not choose them, so no note names them.
    expect(leftOut).toEqual([]);
  });

  it("reads one keyword per country and at most 3 countries", () => {
    const tracked = (keyword: string, countryCode: string) => ({
      keyword,
      saved: true,
      priority: "medium" as const,
      countryCode,
      version: 1,
      source: "saved",
    });
    const { groups, leftOut } = selectTrackedKeywords([
      tracked("battery", "DE"),
      tracked("Battery", "AT"),
      tracked("charger", "CH"),
      tracked("cable", "FR"),
      tracked("adapter", "DE"),
      // No alpha-3 twin, so Search Console cannot filter by it. Chosen first, it still takes no country slot.
      { ...tracked("plug", "XX"), priority: "high" },
    ]);
    expect(groups).toEqual([
      { countryCode: "DE", keywords: ["adapter", "battery"] },
      { countryCode: "AT", keywords: ["battery"] },
      { countryCode: "FR", keywords: ["cable"] },
    ]);
    // One keyword in two countries is two names, each with its country.
    expect(leftOut).toEqual(["plug (XX)", "charger (CH)"]);
  });

  it("keeps a set of long keywords within the filter expression limit", () => {
    const keywords = Array.from({ length: 25 }, (_, i) => ({
      keyword: `${i}${".".repeat(200)}`,
      saved: true,
      priority: "medium" as const,
      countryCode: "US",
      version: 1,
      source: "saved",
    }));
    const { groups, leftOut } = selectTrackedKeywords(keywords);
    expect(leftOut.length).toBeGreaterThan(0);
    const [group] = gscKeywordSeriesArguments(query, groups[0])
      .dimension_filter_groups as Array<{
      filters: Array<{ expression: string }>;
    }>;
    expect(group.filters[1].expression.length).toBeLessThanOrEqual(
      GSC_FILTER_EXPRESSION_LIMIT,
    );
  });

  it("merges case and spacing variants per day with an impression-weighted position", () => {
    const result = normalizeGscKeywordSeries(
      query,
      { countryCode: "US", keywords: ["battery health", "unused keyword"] },
      {
        rows: [
          day("2026-10-10", "Battery Health", 10, 2, 1),
          day("2026-10-10", "battery  health", 30, 6, 2),
          day("2026-10-09", "battery health", 0, 0, 0),
        ],
      },
    );
    expect(result).toEqual({
      rowLimit: SEO_KEYWORD_SERIES_ROW_LIMIT,
      truncated: false,
      keywords: [
        {
          keyword: "battery health",
          countryCode: "US",
          points: [
            { date: "2026-10-09", clicks: 0, impressions: 0, position: null },
            { date: "2026-10-10", clicks: 3, impressions: 40, position: 5 },
          ],
        },
        { keyword: "unused keyword", countryCode: "US", points: [] },
      ],
    });
  });

  it("refuses a query outside the set, a date outside the period, duplicates and other groupings", () => {
    const read = (rows: unknown[]) => () =>
      normalizeGscKeywordSeries(
        query,
        { countryCode: "US", keywords: ["battery"] },
        { rows },
      );
    expect(read([day("2026-10-10", "battery pack", 1, 1)])).toThrow(
      "outside the keywords",
    );
    expect(read([day("2026-11-06", "battery", 1, 1)])).toThrow(
      "outside the period",
    );
    expect(
      read([
        day("2026-10-10", "battery", 1, 1),
        day("2026-10-10", "battery", 1, 1),
      ]),
    ).toThrow("duplicate");
    expect(
      read([{ ...day("2026-10-10", "battery", 1, 1), keys: ["battery"] }]),
    ).toThrow("different keyword grouping");
  });
});
