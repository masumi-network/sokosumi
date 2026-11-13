import { describe, expect, it } from "vitest";

import { seoCreditsForCents, seoMaxCredits } from "./seo-credits.js";

describe("SEO credit ceiling", () => {
  it("adds 50% and rounds up to a whole credit, the same as the worker", () => {
    expect(seoCreditsForCents(0)).toBe(0);
    expect(seoCreditsForCents(1)).toBe(2);
    expect(seoCreditsForCents(2)).toBe(3);
    expect(seoCreditsForCents(30)).toBe(45);
    expect(() => seoCreditsForCents(0.5)).toThrow();
  });

  it("bounds a one-page audit by the page reserve and a site audit by its USD limit", () => {
    expect(seoMaxCredits({ kind: "audit_full", pages: 1 })).toBe(45);
    expect(seoMaxCredits({ kind: "audit_full", pages: 3 })).toBe(450);
    // 0.33 USD is 33 cents: 49.5 credits rounds up to 50, and float noise in 0.33 * 100 is gone.
    expect(seoMaxCredits({ kind: "audit_full", pages: 2, usd: 0.33 })).toBe(50);
    expect(seoMaxCredits({ kind: "audit_full", pages: 10, usd: 50 })).toBe(
      7_500,
    );
  });

  it("bounds a focused check by its paid calls, and a free check at 0", () => {
    expect(seoMaxCredits({ kind: "focused", providerCalls: 20 })).toBe(150);
    expect(seoMaxCredits({ kind: "focused", providerCalls: 1 })).toBe(8);
    expect(seoMaxCredits({ kind: "focused", providerCalls: 0 })).toBe(0);
  });
});
