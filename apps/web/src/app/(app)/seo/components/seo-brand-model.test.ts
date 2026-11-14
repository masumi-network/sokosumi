import { describe, expect, it, vi } from "vitest";
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

  it("matches terms in scripts without spaces as a substring", () => {
    expect(seoIsBrandedQuery("ソニーテレビ", ["ソニー"])).toBe(true);
    expect(seoIsBrandedQuery("ซัมซุงทีวี", ["ซัมซุง"])).toBe(true);
    expect(seoIsBrandedQuery("삼성전자 서비스", ["삼성"])).toBe(true);
    expect(seoIsBrandedQuery("パナソニック", ["ソニー テレビ"])).toBe(false);
  });

  it("reads a change of script in a query as a word bound", () => {
    expect(seoIsBrandedQuery("iPhoneケース", ["iPhone"])).toBe(true);
    expect(seoIsBrandedQuery("LINEの使い方", ["LINE"])).toBe(true);
    expect(seoIsBrandedQuery("华为P50价格", ["P50"])).toBe(true);
    expect(seoIsBrandedQuery("acme靴", ["acme"])).toBe(true);
    expect(seoIsBrandedQuery("acmeshop靴", ["acme"])).toBe(false);
    expect(seoIsBrandedQuery("ソニーテレビ", ["ソニー"])).toBe(true);
  });

  it("reads a Latin term with CJK punctuation as words, not as a substring", () => {
    expect(seoIsBrandedQuery("sony music japan", ["Sony・Music"])).toBe(true);
    expect(seoIsBrandedQuery("paral.lel barcelona", ["paral·lel"])).toBe(true);
    expect(seoIsBrandedQuery("col·legi", ["l·l"])).toBe(false);
  });

  it("keeps marks and letters that tell words apart", () => {
    expect(seoIsBrandedQuery("हिंदू", ["हिंदी"])).toBe(false);
    expect(seoIsBrandedQuery("हिंदी फिल्म", ["हिंदी"])).toBe(true);
    expect(seoIsBrandedQuery("мой магазин", ["мои"])).toBe(false);
    expect(seoIsBrandedQuery("ёлка купить", ["елка"])).toBe(true);
    expect(seoIsBrandedQuery("Αθήνα", ["αθηνα"])).toBe(true);
  });

  it("keeps the signs that make a name distinct", () => {
    expect(seoIsBrandedQuery("c programming", ["C++"])).toBe(false);
    expect(seoIsBrandedQuery("c++ tutorial", ["C++"])).toBe(true);
    expect(seoIsBrandedQuery("c# jobs", ["C#"])).toBe(true);
    expect(seoIsBrandedQuery("at&t login", ["AT&T"])).toBe(true);
    expect(seoIsBrandedQuery("at login", ["AT&T"])).toBe(false);
    expect(seoIsBrandedQuery("acme™ shoes", ["acme"])).toBe(true);
    expect(seoIsBrandedQuery("acme & co", ["acme co"])).toBe(true);
  });

  it("finds a plain term inside a query word joined by a sign", () => {
    expect(seoIsBrandedQuery("johnson&johnson baby", ["johnson"])).toBe(true);
    expect(seoIsBrandedQuery("procter&gamble jobs", ["procter"])).toBe(true);
    expect(seoIsBrandedQuery("procter&gamble", ["procter gamble"])).toBe(true);
    expect(seoIsBrandedQuery("acme&co", ["acme"])).toBe(true);
    expect(seoIsBrandedQuery("acme+ plan", ["acme"])).toBe(true);
    expect(seoIsBrandedQuery("acme#1 deal", ["acme"])).toBe(true);
    // A signed term still needs the whole signed word.
    expect(seoIsBrandedQuery("at t login", ["AT&T"])).toBe(false);
    expect(seoIsBrandedQuery("c programming", ["C++"])).toBe(false);
  });

  it("ignores Arabic and Hebrew vowel marks", () => {
    expect(seoIsBrandedQuery("مُحَمَّد للتجارة", ["محمد"])).toBe(true);
    expect(seoIsBrandedQuery("محمد للتجارة", ["مُحَمَّد"])).toBe(true);
    expect(seoIsBrandedQuery("שָׁלוֹם בית", ["שלום"])).toBe(true);
  });

  it("matches nothing with a term that has no letter or digit", () => {
    expect(seoIsBrandedQuery("c++ ++ tips", ["++"])).toBe(false);
    expect(seoIsBrandedQuery("&&", ["&&"])).toBe(false);
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

  it("prepares each term once per list, not once per query", () => {
    const terms = Array.from({ length: 20 }, (_, index) => `brand${index}`);
    const rows = Array.from({ length: 100 }, (_, index) => ({
      query: `running shoes ${index}`,
      clicks: 1,
      impressions: 1,
    }));
    const normalize = vi.spyOn(String.prototype, "normalize");
    try {
      seoBrandTotals(rows, terms);
      // A few calls per query and per term; a per-row term rebuild would need 4,000.
      expect(normalize.mock.calls.length).toBeLessThan(
        10 * (rows.length + terms.length),
      );
    } finally {
      normalize.mockRestore();
    }
  });
});
