import { describe, expect, it, vi } from "vitest";
import {
  seoBrandRows,
  seoBrandSuggestion,
  seoBrandTotals,
  seoParseBrandTerms,
  seoSiteBrandSplit,
} from "./seo-brand-model";

describe("branded query split", () => {
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

describe("site brand split", () => {
  const counts = (clicks: number, impressions = 0) => ({ clicks, impressions });
  const daily = [
    { date: "2026-11-01", ...counts(7, 70) },
    { date: "2026-11-02", ...counts(3, 30) },
  ];
  const day = (date: string, branded: number, nonBranded: number) => ({
    date,
    branded: counts(branded, branded * 10),
    nonBranded: counts(nonBranded, nonBranded * 10),
  });

  it("puts the traffic without a listed query in a third part", () => {
    const split = seoSiteBrandSplit(
      { daily, brand: { daily: [day("2026-11-01", 2, 1)], limited: false } },
      "clicks",
    );
    expect(split?.totals).toEqual({ branded: 2, nonBranded: 1, unlisted: 7 });
    expect(split?.all).toBe(10);
    // A day without query rows is all unlisted, and still a point on each trend.
    expect(split?.points.branded.map((point) => point.value)).toEqual([2, 0]);
    expect(split?.points.unlisted?.map((point) => point.value)).toEqual([4, 3]);
  });

  it("gives no third part when it cannot be proved", () => {
    const brand = { daily: [day("2026-11-01", 2, 1)], limited: false };
    const unlisted = (report: Parameters<typeof seoSiteBrandSplit>[0]) =>
      seoSiteBrandSplit(report, "clicks")?.totals.unlisted;
    expect(unlisted({ daily, brand: { ...brand, limited: true } })).toBeNull();
    expect(unlisted({ brand })).toBeNull();
    // The rows hold more clicks than the day total, or a day the totals do not have.
    expect(
      unlisted({
        daily,
        brand: { ...brand, daily: [day("2026-11-02", 3, 1)] },
      }),
    ).toBeNull();
    expect(
      unlisted({
        daily,
        brand: { ...brand, daily: [day("2026-10-31", 1, 0)] },
      }),
    ).toBeNull();
    expect(seoSiteBrandSplit({ daily }, "clicks")).toBeNull();
  });

  it("keeps a day without a total on the trend and gives no share then", () => {
    const split = seoSiteBrandSplit(
      {
        daily: daily.slice(0, 1),
        brand: { daily: [day("2026-11-02", 7, 0)], limited: false },
      },
      "clicks",
    );
    expect(split?.points.branded.map((point) => point.value)).toEqual([0, 7]);
    expect(split?.totals.branded).toBe(7);
    expect(split?.all).toBeNull();
  });

  it("takes shares of the whole traffic when the rows were cut", () => {
    const split = seoSiteBrandSplit(
      { daily, brand: { daily: [day("2026-11-01", 1, 0)], limited: true } },
      "clicks",
    );
    expect(split).toMatchObject({ all: 10, limited: true });
    // The second day has a total but no rows: after a cut that is unknown, not zero.
    expect(split?.points.branded.map((point) => point.value)).toEqual([
      1,
      null,
    ]);
    expect(split?.totals).toEqual({
      branded: 1,
      nonBranded: 0,
      unlisted: null,
    });
  });

  it("suggests the site name as words and as one word", () => {
    expect(seoBrandSuggestion("battery-sensei.app")).toEqual([
      "battery sensei",
      "batterysensei",
    ]);
    expect(seoBrandSuggestion("www.example.com")).toEqual(["example"]);
    expect(seoBrandSuggestion("support.example.com")).toEqual([]);
    expect(seoBrandSuggestion("example.co.uk")).toEqual([]);
    expect(seoBrandSuggestion("localhost")).toEqual([]);
    expect(seoBrandSuggestion("xn--mnchen-3ya.de")).toEqual([]);
  });
});
