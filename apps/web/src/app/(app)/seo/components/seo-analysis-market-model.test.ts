import { describe, expect, it } from "vitest";
import {
  changeSeoAnalysisMarket,
  editSeoAnalysisKeywords,
  initialSeoAnalysisMarket,
  seoAnalysisKeywordDraft,
  seoDefaultMarket,
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
  it("cuts the saved keywords to what the check type takes, and leaves typed text alone", () => {
    const us = changeSeoAnalysisMarket(initialSeoAnalysisMarket(KEYWORDS), {
      countryCode: "US",
      languageCode: "en",
    });
    const saved = [
      ...KEYWORDS,
      {
        keyword: "battery wear",
        countryCode: "US",
        languageCode: "en",
        saved: true,
      },
    ];
    expect(seoAnalysisKeywordDraft(us, saved)).toBe(
      "battery health\nbattery wear",
    );
    expect(seoAnalysisKeywordDraft(us, saved, 1)).toBe("battery health");
    const typed = editSeoAnalysisKeywords(us, "one\ntwo");
    expect(seoAnalysisKeywordDraft(typed, saved, 1)).toBe("one\ntwo");
  });

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

describe("SEO check default market", () => {
  const page = (id: string, url: string) => ({ id, url });
  const workspace = (
    pages: { id: string; url: string }[],
    observations: object[] = [],
  ) =>
    ({
      pages,
      scope: { pageIds: pages.map((row) => row.id) },
      observations,
    }) as unknown as Parameters<typeof seoDefaultMarket>[0];

  it("takes the newest check's market, then the country of the page's domain, then US English", () => {
    expect(
      seoDefaultMarket(workspace([page("a", "https://example.com/")])),
    ).toEqual({ countryCode: "US", languageCode: "en" });
    expect(
      seoDefaultMarket(workspace([page("a", "https://www.beispiel.at/x")])),
    ).toEqual({ countryCode: "AT", languageCode: "de" });
    // The newest check decides, in whatever order Core lists them. A check without a language,
    // or in a country the form cannot choose, does not.
    const checks = [
      {
        observedAt: new Date("2026-02-01T00:00:00Z"),
        countryCode: "FR",
        languageCode: "fr",
      },
      {
        observedAt: new Date("2026-03-01T00:00:00Z"),
        countryCode: "DE",
        languageCode: null,
      },
      {
        observedAt: new Date("2026-04-01T00:00:00Z"),
        countryCode: "JP",
        languageCode: "ja",
      },
      {
        observedAt: new Date("2026-01-01T00:00:00Z"),
        countryCode: "ES",
        languageCode: "es",
      },
    ];
    expect(
      seoDefaultMarket(workspace([page("a", "https://beispiel.de/")], checks)),
    ).toEqual({ countryCode: "FR", languageCode: "fr" });
  });

  it("reads the domain of a selected page, not of a page outside the selection", () => {
    const data = workspace([
      page("a", "https://example.fr/"),
      page("b", "https://example.it/"),
    ]);
    data.scope.pageIds = ["b"];
    expect(seoDefaultMarket(data)).toEqual({
      countryCode: "IT",
      languageCode: "it",
    });
    // A page without a readable address names no country.
    expect(seoDefaultMarket(workspace([page("a", "not a url")]))).toEqual({
      countryCode: "US",
      languageCode: "en",
    });
  });
});
