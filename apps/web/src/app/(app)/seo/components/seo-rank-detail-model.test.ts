import { describe, expect, it } from "vitest";
import {
  seoRankAbsentOthers,
  seoRankDetail,
  seoRankResult,
  seoRankShownTop,
} from "./seo-rank-detail-model";

// The lines of a real check (battery-sensei.app, 2026-11-16).
const ABSENT_LINES = [
  '"macbook charge limit", Market US, en (location_code 2840), mobile, DataForSEO SERP of 2026-11-16 23:50:46 +00:00: 16 organic results read',
  "the page is not in the top 16 organic results",
  "an AI Overview shows and does not cite the page",
  "position rule: rank_group counts the items of one type (organic, featured_snippet), rank_absolute counts every result item (DataForSEO, N2-508)",
  '"mac battery health checker" (goal): the page is not in the top 18 organic results',
  '"macbook battery monitor" (goal): the page is not in the top 16 organic results',
  '"macbook battery health" (goal): the page is not in the top 15 organic results',
];

describe("seoRankDetail", () => {
  it("reads the lead keyword, its Market, device, time, result, AI Overview and other keywords", () => {
    expect(seoRankDetail(ABSENT_LINES)).toEqual({
      keyword: "macbook charge limit",
      country: "US",
      language: "en",
      device: "mobile",
      readAt: new Date("2026-11-16T23:50:46Z"),
      result: { kind: "absent", top: 16 },
      searchConsole: null,
      aiOverviewCites: false,
      others: [
        {
          keyword: "mac battery health checker",
          result: { kind: "absent", top: 18 },
        },
        {
          keyword: "macbook battery monitor",
          result: { kind: "absent", top: 16 },
        },
        {
          keyword: "macbook battery health",
          result: { kind: "absent", top: 15 },
        },
      ],
    });
  });

  it("reads a ranked page after a Search Console line, and a ranked other keyword", () => {
    const detail = seoRankDetail([
      '"battery app", desktop: Search Console average position 4.2 over final data 2026-10-16 to 2026-11-12, 120 impressions, 9 clicks, country DEU (all languages)',
      '"battery app", Market DE, de (location_code 2276), desktop, DataForSEO SERP of 2026-11-16 08:00:00 +01:00: 20 organic results read',
      "the page at featured_snippet position 1 (rank_absolute 1): https://example.com/",
      "ranked above it: organic position 1 (rank_absolute 2): https://other.example/",
      "the AI Overview cites the page",
      '"battery tool" (goal): Search Console 3.0 (40 impressions); SERP: the page at organic position 4 (rank_absolute 6): https://example.com/',
    ]);
    expect(detail).toMatchObject({
      keyword: "battery app",
      device: "desktop",
      readAt: new Date("2026-11-16T07:00:00Z"),
      result: { kind: "ranked", featured: true, position: 1 },
      searchConsole: { kind: "searchConsole", position: 4.2 },
      aiOverviewCites: true,
      others: [
        {
          keyword: "battery tool",
          result: { kind: "searchConsole", position: 3 },
        },
      ],
    });
  });

  it("gives up on lines of another shape, so the row shows them all", () => {
    expect(seoRankDetail(["mobile SERP not read: timeout"])).toBeNull();
    // A head without a position line after it is no result.
    expect(seoRankDetail(ABSENT_LINES.slice(0, 1))).toBeNull();
    expect(
      seoRankDetail([ABSENT_LINES[0], "the SERP holds no organic results"]),
    ).toBeNull();
  });

  it("keeps the AI Overview unknown when the results showed none", () => {
    expect(seoRankDetail(ABSENT_LINES.slice(0, 2))?.aiOverviewCites).toBe(null);
  });

  it("keeps the AI Overview unknown when a source hides its URL, never 'not cited'", () => {
    const detail = seoRankDetail([
      ...ABSENT_LINES.slice(0, 2),
      "an AI Overview shows; whether it cites the page is not determined: a source hides its URL behind a Google redirect",
    ]);
    expect(detail?.aiOverviewCites).toBe(null);
  });
});

describe("seoRankResult", () => {
  it("reads a keyword whose read gave no place, so the row lists it apart", () => {
    const detail = seoRankDetail([
      ...ABSENT_LINES.slice(0, 2),
      '"battery app" (goal): the page is not placed: 1 result on its host hides its URL behind a Google redirect',
      '"battery tool" (goal): mobile SERP not read: error "x" (goal): z',
    ]);
    expect(detail?.others).toEqual([
      expect.objectContaining({ keyword: "battery app" }),
      {
        keyword: "battery tool",
        result: {
          kind: "other",
          text: 'mobile SERP not read: error "x" (goal): z',
        },
      },
    ]);
  });

  it("keeps a line it cannot read as text", () => {
    // A line cut at the coworker's length cap names no position.
    expect(seoRankResult("the page at organic position 12…").kind).toBe(
      "other",
    );
    expect(seoRankResult("no organic results")).toEqual({
      kind: "other",
      text: "no organic results",
    });
  });
});

describe("seoRankShownTop", () => {
  it("rounds the results read down to a step of five, never up", () => {
    expect([9, 10, 14, 16, 18, 20, 23].map(seoRankShownTop)).toEqual([
      9, 10, 10, 15, 15, 20, 20,
    ]);
  });
});

describe("seoRankAbsentOthers", () => {
  it("counts the keywords outside the results and names the smallest top", () => {
    const others = seoRankDetail(ABSENT_LINES)?.others ?? [];
    expect(seoRankAbsentOthers(others)).toEqual({ count: 3, top: 15 });
    expect(
      seoRankAbsentOthers([
        {
          keyword: "x",
          result: { kind: "ranked", featured: false, position: 2 },
        },
      ]),
    ).toBeNull();
  });
});
