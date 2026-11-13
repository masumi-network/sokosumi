import { describe, expect, it } from "vitest";
import {
  ga4LandingPageArguments,
  normalizeGa4LandingPages,
} from "./native-ga4-landing";
import type { NativeStatisticsQuery } from "./native-statistics";

const query: NativeStatisticsQuery = {
  provider: "ga4",
  propertyId: "properties/123",
  pageUrls: ["https://example.com/", "https://example.com/shop?ref=nav"],
  from: "2026-01-01",
  to: "2026-01-31",
  channel: "all",
};
function report(rows: Array<[string, string, string]>) {
  return {
    dimensionHeaders: [{ name: "landingPagePlusQueryString" }],
    metricHeaders: [{ name: "sessions" }, { name: "keyEvents" }],
    rows: rows.map(([path, sessions, keyEvents]) => ({
      dimensionValues: [{ value: path }],
      metricValues: [{ value: sessions }, { value: keyEvents }],
    })),
  };
}

describe("GA4 key events per landing page", () => {
  it("asks for the selected paths with their query strings, organic sessions only, whatever the channel", () => {
    const args = ga4LandingPageArguments(query);
    expect(args.dimensionFilter).toEqual({
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: "landingPagePlusQueryString",
              inListFilter: {
                values: ["/", "/shop?ref=nav"],
                caseSensitive: true,
              },
            },
          },
          {
            filter: {
              fieldName: "sessionDefaultChannelGroup",
              stringFilter: {
                matchType: "EXACT",
                value: "Organic Search",
                caseSensitive: true,
              },
            },
          },
        ],
      },
    });
    expect(args.limit).toBe(2);
  });

  it("maps each landing path back to its page and leaves an unreported page out", () => {
    expect(
      normalizeGa4LandingPages(query, report([["/shop?ref=nav", "12", "0"]])),
    ).toEqual({
      channel: "organic",
      rows: [
        {
          pageUrl: "https://example.com/shop?ref=nav",
          sessions: 12,
          keyEvents: 0,
        },
      ],
    });
  });

  it("refuses a landing page outside the selection, a repeated one or another grouping", () => {
    expect(() =>
      normalizeGa4LandingPages(query, report([["/other", "1", "1"]])),
    ).toThrow("outside the selection");
    expect(() =>
      normalizeGa4LandingPages(
        query,
        report([
          ["/", "1", "1"],
          ["/", "2", "0"],
        ]),
      ),
    ).toThrow("outside the selection");
    expect(() =>
      normalizeGa4LandingPages(query, {
        ...report([]),
        metricHeaders: [{ name: "keyEvents" }, { name: "sessions" }],
      }),
    ).toThrow("different landing page grouping");
  });

  it("splits an AI Assistant read by assistant and adds each page up", () => {
    const aiQuery = { ...query, channel: "ai_assistant" as const };
    const args = ga4LandingPageArguments(aiQuery);
    expect(args.dimensions).toEqual([
      { name: "landingPagePlusQueryString" },
      { name: "sessionSource" },
    ]);
    expect(JSON.stringify(args.dimensionFilter)).toContain(
      '"value":"AI Assistant"',
    );
    const sourced = (rows: Array<[string, string, string, string]>) => ({
      dimensionHeaders: [
        { name: "landingPagePlusQueryString" },
        { name: "sessionSource" },
      ],
      metricHeaders: [{ name: "sessions" }, { name: "keyEvents" }],
      rows: rows.map(([path, source, sessions, keyEvents]) => ({
        dimensionValues: [{ value: path }, { value: source }],
        metricValues: [{ value: sessions }, { value: keyEvents }],
      })),
      rowCount: rows.length,
    });
    expect(
      normalizeGa4LandingPages(
        aiQuery,
        sourced([
          ["/", "perplexity.ai", "2", "0"],
          ["/", "chatgpt.com", "5", "1"],
          ["/shop?ref=nav", "chatgpt.com", "1", "1"],
        ]),
      ),
    ).toEqual({
      channel: "ai_assistant",
      rows: [
        { pageUrl: "https://example.com/", sessions: 7, keyEvents: 1 },
        {
          pageUrl: "https://example.com/shop?ref=nav",
          sessions: 1,
          keyEvents: 1,
        },
      ],
      sources: [
        {
          pageUrl: "https://example.com/",
          source: "chatgpt.com",
          sessions: 5,
          keyEvents: 1,
        },
        {
          pageUrl: "https://example.com/",
          source: "perplexity.ai",
          sessions: 2,
          keyEvents: 0,
        },
        {
          pageUrl: "https://example.com/shop?ref=nav",
          source: "chatgpt.com",
          sessions: 1,
          keyEvents: 1,
        },
      ],
      truncated: false,
    });
    // No AI Assistant rows is no data, not a guess from a referrer list.
    expect(normalizeGa4LandingPages(aiQuery, sourced([]))).toEqual({
      channel: "ai_assistant",
      rows: [],
      sources: [],
      truncated: false,
    });
    // A row cut by the limit makes the page sums a floor.
    expect(
      normalizeGa4LandingPages(aiQuery, {
        ...sourced([["/", "chatgpt.com", "5", "1"]]),
        rowCount: 300,
      }).truncated,
    ).toBe(true);
  });
});
