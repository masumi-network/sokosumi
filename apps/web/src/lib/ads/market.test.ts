import { describe, expect, it } from "vitest";

import {
  createMarketProfileSchema,
  MARKET_KEYWORD_LIMIT,
  MARKET_KEYWORD_MAX_LENGTH,
  marketOptions,
  marketSummary,
} from "./market";

describe("market profile limits", () => {
  it("come from Core's schema", () => {
    expect(MARKET_KEYWORD_LIMIT).toBe(10);
    expect(MARKET_KEYWORD_MAX_LENGTH).toBe(80);
  });
});

describe("createMarketProfileSchema", () => {
  const valid = {
    keywords: [" running shoes "],
    countryCode: "DE",
    languageCode: "de",
  };

  it("trims keywords and accepts a supported market", () => {
    expect(createMarketProfileSchema().parse(valid)).toEqual({
      ...valid,
      keywords: ["running shoes"],
    });
  });

  it.each([
    ["no keywords", { keywords: [] }],
    [
      "too many keywords",
      { keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) },
    ],
    ["a blank keyword", { keywords: ["  "] }],
    ["a long keyword", { keywords: ["x".repeat(81)] }],
    ["an unsupported country", { countryCode: "ZZ" }],
    ["an unsupported language", { languageCode: "xx" }],
    ["no country", { countryCode: undefined }],
  ])("rejects %s", (_name, override) => {
    expect(
      createMarketProfileSchema().safeParse({ ...valid, ...override }).success,
    ).toBe(false);
  });

  it("uses the messages it is given", () => {
    const result = createMarketProfileSchema({
      keywordsRequired: "Add one.",
      countryRequired: "Pick a country.",
    }).safeParse({ ...valid, keywords: [], countryCode: "" });

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Add one.",
      "Pick a country.",
    ]);
  });
});

describe("marketOptions", () => {
  it("names every supported country and language, sorted by name", () => {
    const { countries, languages } = marketOptions("en");

    expect(countries).toHaveLength(17);
    expect(countries.slice(0, 3).map(({ name }) => name)).toEqual([
      "Australia",
      "Austria",
      "Belgium",
    ]);
    expect(countries).toContainEqual({ code: "GB", name: "United Kingdom" });
    expect(languages).toContainEqual({ code: "de", name: "German" });
  });

  it("names them in the reader's language", () => {
    expect(marketOptions("de").languages).toContainEqual({
      code: "fr",
      name: "Französisch",
    });
  });
});

describe("marketSummary", () => {
  it("reads keywords, country and language on one line", () => {
    expect(
      marketSummary(
        {
          keywords: ["running shoes", "trail shoes"],
          countryCode: "DE",
          languageCode: "de",
          updatedAt: new Date(),
        },
        "en",
      ),
    ).toBe("running shoes, trail shoes · Germany · German");
  });
});
