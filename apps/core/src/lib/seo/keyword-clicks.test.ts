import { describe, expect, it } from "vitest";
import { seoClickRate, seoKeywordClicks } from "./keyword-clicks";

describe("SEO keyword click estimate", () => {
  it("takes the published unbranded rate in the top 10", () => {
    expect(seoClickRate(1)).toBeCloseTo(0.1938, 6);
    expect(seoClickRate(3)).toBeCloseTo(0.0602, 6);
    expect(seoClickRate(10)).toBeCloseTo(0.0081, 6);
  });

  it("never gives a lower place more clicks than the place above it", () => {
    const rates = Array.from({ length: 20 }, (_, index) =>
      seoClickRate(index + 1),
    );
    for (let index = 1; index < rates.length; index++)
      expect(rates[index]).toBeLessThanOrEqual(rates[index - 1]);
    // Published 0.82 % on place 13 is above place 10: the cap keeps it at place 11's 0.67 %.
    expect(seoClickRate(13)).toBeCloseTo(0.0067, 6);
    expect(seoClickRate(20)).toBeCloseTo(0.0027, 6);
  });

  it("counts no clicks past place 20, with no position, or for a place under 1", () => {
    expect(seoClickRate(21)).toBe(0);
    expect(seoClickRate(null)).toBe(0);
    expect(seoClickRate(0)).toBe(0);
    expect(seoClickRate(Number.NaN)).toBe(0);
  });

  it("rounds an average position to its nearest place", () => {
    expect(seoClickRate(2.4)).toBe(seoClickRate(2));
    expect(seoClickRate(2.6)).toBe(seoClickRate(3));
  });

  it("gives clicks now and at the goal places, and none without a volume", () => {
    expect(seoKeywordClicks(1000, 15)).toEqual({
      now: 7,
      top10: 8,
      top3: 60,
      top1: 194,
    });
    expect(seoKeywordClicks(1000, null)?.now).toBe(0);
    expect(seoKeywordClicks(null, 1)).toBeNull();
    expect(seoKeywordClicks(-5, 1)).toBeNull();
  });
});
