import { describe, expect, it } from "vitest";
import {
  changeSeoAnalysisMarket,
  editSeoAnalysisKeywords,
  initialSeoAnalysisMarket,
  seoAnalysisKeywordDraft,
} from "./seo-analysis-market-model";

const KEYWORDS = [
  {
    keyword: "Akku Zustand",
    countryCode: "DE",
    languageCode: "de",
    saved: true,
  },
  {
    keyword: "AKKU   ZUSTAND",
    countryCode: "DE",
    languageCode: "de",
    saved: true,
  },
  {
    keyword: "battery health",
    countryCode: "US",
    languageCode: "en",
    saved: true,
  },
  {
    keyword: "battery charge",
    countryCode: "US",
    languageCode: "en",
    saved: false,
  },
  {
    keyword: "Akkuzustand",
    countryCode: "US",
    languageCode: "de",
    saved: true,
  },
];

describe("SEO analysis keyword market drafts", () => {
  it("prefills only exact saved market identities and deduplicates observed device rows", () => {
    const initial = initialSeoAnalysisMarket(KEYWORDS);
    expect(seoAnalysisKeywordDraft(initial, KEYWORDS)).toBe("Akku Zustand");
    const us = changeSeoAnalysisMarket(initial, {
      countryCode: "US",
      languageCode: "en",
    });
    expect(seoAnalysisKeywordDraft(us, KEYWORDS)).toBe("battery health");
    expect(
      seoAnalysisKeywordDraft(
        changeSeoAnalysisMarket(us, { languageCode: "de" }),
        KEYWORDS,
      ),
    ).toBe("Akkuzustand");
    expect(
      seoAnalysisKeywordDraft(
        changeSeoAnalysisMarket(us, { languageCode: "es" }),
        KEYWORDS,
      ),
    ).toBe("");
    const unicode = ["Café", "Cafe\u0301"].map((keyword) => ({
      ...KEYWORDS[0],
      keyword,
    }));
    expect(seoAnalysisKeywordDraft(initial, unicode)).toBe("Café");
  });

  it("preserves edited and intentionally empty drafts without mutating the earlier market state", () => {
    const initial = initialSeoAnalysisMarket(KEYWORDS);
    const edited = editSeoAnalysisKeywords(
      initial,
      "Mein Entwurf\nZweiter Begriff",
    );
    const us = changeSeoAnalysisMarket(edited, {
      countryCode: "US",
      languageCode: "en",
    });
    const emptied = editSeoAnalysisKeywords(us, "");
    expect(seoAnalysisKeywordDraft(emptied, KEYWORDS)).toBe("");
    const de = changeSeoAnalysisMarket(emptied, {
      countryCode: "DE",
      languageCode: "de",
    });
    expect(seoAnalysisKeywordDraft(de, KEYWORDS)).toBe(
      "Mein Entwurf\nZweiter Begriff",
    );
    expect(seoAnalysisKeywordDraft(initial, KEYWORDS)).toBe("Akku Zustand");
    expect(initial.drafts.size).toBe(0);
  });

  it("does not infer a market from unsaved measurements", () => {
    const initial = initialSeoAnalysisMarket(
      KEYWORDS.map((row) => ({ ...row, saved: false })),
    );
    expect(initial.countryCode).toBe("");
    expect(initial.languageCode).toBe("");
    expect(seoAnalysisKeywordDraft(initial, KEYWORDS)).toBe("");
  });
});
