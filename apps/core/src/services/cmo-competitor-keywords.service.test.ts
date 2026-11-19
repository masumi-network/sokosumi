import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  fetchComparisonSearches: vi.fn(),
  cmoSearchAdBudget: vi.fn(),
  listTrackedCompetitors: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSeoResearch: { findUnique: m.findUnique, upsert: m.upsert },
  },
}));
vi.mock("@/lib/ads/dataforseo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ads/dataforseo")>()),
  fetchComparisonSearches: m.fetchComparisonSearches,
}));
vi.mock("@/services/cmo-ads.service", () => ({
  cmoSearchAdBudget: m.cmoSearchAdBudget,
}));
vi.mock("@/services/cmo-seo-market", () => ({
  cmoSeoMarket: async () => ({
    countryCode: "US",
    languageCode: "en",
    locationCode: 2840,
  }),
}));
vi.mock("@/services/competitors.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/competitors.service")>()),
  listTrackedCompetitors: m.listTrackedCompetitors,
}));

import type { Cuso } from "@/services/cmo-cuso.service";
import {
  comparisonKind,
  readCmoCompetitorKeywords,
} from "./cmo-competitor-keywords.service";

const cuso = { projectId: "project-1", websiteUrl: "https://cal.com" } as Cuso;
const NOW = new Date("2026-11-19T10:00:00Z");

const search = (keyword: string, searchVolume: number | null, bid = 2) => ({
  keyword,
  searchVolume,
  cpc: 12,
  lowTopOfPageBid: bid,
  highTopOfPageBid: 19,
  competition: "MEDIUM" as const,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.listTrackedCompetitors.mockResolvedValue([{ name: "Calendly" }]);
  m.cmoSearchAdBudget.mockResolvedValue(null);
  m.findUnique.mockResolvedValue(null);
});

describe("comparisonKind", () => {
  it.each([
    ["calendly alternative", "alternative"],
    ["calendly alternativen", "alternative"],
    ["calendly competitors", "alternative"],
    ["cal.com vs calendly", "versus"],
    ["calendly alternative vs doodle", "versus"],
    ["calendly pricing", "pricing"],
    ["how much does calendly cost", "pricing"],
    ["calendly stock price", null],
    ["cal.com vs calendly reddit", null],
    ["jim acosta substack", null],
    ["calendly login", null],
  ])("%s is %s", (keyword, kind) => {
    expect(comparisonKind(keyword)).toBe(kind);
  });
});

describe("readCmoCompetitorKeywords", () => {
  it("reads a competitor once and keeps the buyer's searches with a volume", async () => {
    m.fetchComparisonSearches.mockResolvedValue([
      search("calendly pricing", 4400),
      search("calendly stock price", 20),
      search("calendly vs zcal", null),
      search("calendly alternative", 260),
    ]);

    const read = await readCmoCompetitorKeywords(cuso, NOW);

    expect(m.fetchComparisonSearches).toHaveBeenCalledWith({
      product: "calendly",
      locationCode: 2840,
      languageCode: "en",
    });
    expect(m.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_kind_key: {
            projectId: "project-1",
            kind: "comparison_searches",
            key: "calendly|US|en",
          },
        },
      }),
    );
    expect(read).toEqual({
      countryCode: "US",
      languageCode: "en",
      competitors: [
        {
          name: "Calendly",
          observedAt: NOW.toISOString(),
          searches: [
            {
              ...search("calendly pricing", 4400),
              kind: "pricing",
              alsoSearchedAs: [],
              fitsBudget: false,
            },
            {
              ...search("calendly alternative", 260),
              kind: "alternative",
              alsoSearchedAs: [],
              fitsBudget: false,
            },
          ],
        },
      ],
      adBudget: null,
    });
  });

  it("lists the ways of wording one search once, under the most searched", async () => {
    m.fetchComparisonSearches.mockResolvedValue([
      search("calendly pricing", 4400),
      search("calendly price", 3600),
      search("alternatives calendly", 880),
      search("calendly alternatives", 880),
      search("calendly cost", 590),
      search("calendly alternative free", 390),
      search("cal.com vs calendly", 320),
      search("calendly competitors", 320),
      search("how much does calendly cost", 260),
      search("alternative to calendly", 260),
      search("calendly versus cal.com", 90),
    ]);

    const read = await readCmoCompetitorKeywords(cuso, NOW);

    expect(
      read.competitors[0]?.searches.map((row) => [
        row.keyword,
        row.searchVolume,
        row.alsoSearchedAs,
      ]),
    ).toEqual([
      ["calendly pricing", 4400, ["calendly price", "calendly cost"]],
      [
        "alternatives calendly",
        880,
        [
          "calendly alternatives",
          "calendly competitors",
          "alternative to calendly",
        ],
      ],
      ["calendly alternative free", 390, []],
      ["cal.com vs calendly", 320, ["calendly versus cal.com"]],
      ["how much does calendly cost", 260, []],
    ]);
  });

  it("uses a read of the last week again without paying", async () => {
    m.findUnique.mockResolvedValue({
      observedAt: new Date("2026-11-14T10:00:00Z"),
      payload: {
        name: "Calendly",
        countryCode: "US",
        languageCode: "en",
        searches: [search("calendly alternative", 260)],
      },
    });

    const read = await readCmoCompetitorKeywords(cuso, NOW);

    expect(m.fetchComparisonSearches).not.toHaveBeenCalled();
    expect(read.competitors[0]).toMatchObject({
      observedAt: "2026-11-14T10:00:00.000Z",
      searches: [{ keyword: "calendly alternative", kind: "alternative" }],
    });
  });

  it("reads again once the stored read is a week old", async () => {
    m.findUnique.mockResolvedValue({
      observedAt: new Date("2026-11-11T10:00:00Z"),
      payload: {
        name: "Calendly",
        countryCode: "US",
        languageCode: "en",
        searches: [],
      },
    });
    m.fetchComparisonSearches.mockResolvedValue([]);

    await readCmoCompetitorKeywords(cuso, NOW);

    expect(m.fetchComparisonSearches).toHaveBeenCalledTimes(1);
  });

  it("lists a competitor whose read failed without searches, and keeps the others", async () => {
    m.listTrackedCompetitors.mockResolvedValue([
      { name: "Calendly" },
      { name: "SavvyCal" },
    ]);
    m.fetchComparisonSearches
      .mockRejectedValueOnce(new Error("DataForSEO refused the request"))
      .mockResolvedValueOnce([search("savvycal pricing", 20)]);

    const read = await readCmoCompetitorKeywords(cuso, NOW);

    expect(read.competitors).toEqual([
      { name: "Calendly", observedAt: null, searches: [] },
      {
        name: "SavvyCal",
        observedAt: NOW.toISOString(),
        searches: [
          {
            ...search("savvycal pricing", 20),
            kind: "pricing",
            alsoSearchedAs: [],
            fitsBudget: false,
          },
        ],
      },
    ]);
    expect(m.upsert).toHaveBeenCalledTimes(1);
  });

  it("marks the searches the daily budget pays for, most searched first", async () => {
    // 20 a day: one ad may pay 6.66 a click, two 3.33, three 2.22.
    m.cmoSearchAdBudget.mockResolvedValue({
      currency: "USD",
      perDay: 20,
      searchAds: 0,
    });
    m.fetchComparisonSearches.mockResolvedValue([
      search("calendly pricing", 4400, 1.33),
      search("calendly alternatives", 880, 2.53),
      search("calendly alternative free", 390, 2.76),
      search("cal.com vs calendly", 320, 1.64),
    ]);

    const read = await readCmoCompetitorKeywords(cuso, NOW);

    expect(
      read.competitors[0]?.searches.map((row) => [row.keyword, row.fitsBudget]),
    ).toEqual([
      ["calendly pricing", true],
      ["calendly alternatives", true],
      // A third ad would cap a click at 2.22, under both ads' lowest bids.
      ["calendly alternative free", false],
      ["cal.com vs calendly", false],
    ]);
    expect(read.adBudget).toEqual({
      currency: "USD",
      perDay: 20,
      searchAds: 0,
      roomFor: 2,
    });
  });

  it("counts the search ads already written against the day", async () => {
    m.cmoSearchAdBudget.mockResolvedValue({
      currency: "USD",
      perDay: 20,
      searchAds: 2,
    });
    m.fetchComparisonSearches.mockResolvedValue([
      search("calendly pricing", 4400, 1.33),
      search("calendly alternatives", 880, 2.53),
    ]);

    const read = await readCmoCompetitorKeywords(cuso, NOW);

    expect(read.adBudget?.roomFor).toBe(1);
    expect(read.competitors[0]?.searches[0]?.fitsBudget).toBe(true);
    expect(read.competitors[0]?.searches[1]?.fitsBudget).toBe(false);
  });

  it("marks nothing when one click costs more than a third of the day", async () => {
    m.cmoSearchAdBudget.mockResolvedValue({
      currency: "USD",
      perDay: 5,
      searchAds: 0,
    });
    m.fetchComparisonSearches.mockResolvedValue([
      search("calendly alternative", 260, 2),
    ]);

    const read = await readCmoCompetitorKeywords(cuso, NOW);

    expect(read.adBudget?.roomFor).toBe(0);
    expect(read.competitors[0]?.searches[0]?.fitsBudget).toBe(false);
  });
});
