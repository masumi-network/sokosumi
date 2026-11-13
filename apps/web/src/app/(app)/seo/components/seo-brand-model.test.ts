import { describe, expect, it } from "vitest";
import {
  seoBrandRows,
  seoBrandTotals,
  seoIsBrandedQuery,
  seoParseBrandTerms,
} from "./seo-brand-model";

describe("branded query split", () => {
  it("ignores case and accents on both sides", () => {
    expect(seoIsBrandedQuery("ACME shoes", ["acme"])).toBe(true);
    expect(
      seoIsBrandedQuery("cafe muller opening hours", ["Café Müller"]),
    ).toBe(true);
    expect(seoIsBrandedQuery("Café Müller", ["cafe muller"])).toBe(true);
  });

  it("matches whole words in order, never part of a word", () => {
    expect(seoIsBrandedQuery("party supplies", ["art"])).toBe(false);
    expect(seoIsBrandedQuery("acmeshop login", ["acme"])).toBe(false);
    expect(seoIsBrandedQuery("acme.com login", ["acme com"])).toBe(true);
    expect(seoIsBrandedQuery("shop acme", ["acme shop"])).toBe(false);
    expect(seoIsBrandedQuery("anything", ["", "  "])).toBe(false);
  });

  it("lists one side per view and all rows without terms", () => {
    const rows = [
      { query: "acme shoes", clicks: 4, impressions: 10 },
      { query: "running shoes", clicks: 1, impressions: 30 },
    ];
    expect(seoBrandRows(rows, ["acme"], "branded")).toEqual([rows[0]]);
    expect(seoBrandRows(rows, ["acme"], "non_branded")).toEqual([rows[1]]);
    expect(seoBrandRows(rows, [], "branded")).toEqual(rows);
    expect(seoBrandTotals(rows, ["acme"])).toEqual({
      branded: { clicks: 4, impressions: 10 },
      nonBranded: { clicks: 1, impressions: 30 },
    });
  });

  it("reads one term per line or between commas", () => {
    expect(seoParseBrandTerms("Acme,\n acme shop \n\n,ACME")).toEqual([
      "Acme",
      "acme shop",
      "ACME",
    ]);
  });
});
