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
});
