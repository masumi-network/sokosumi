export const SEO_TEST_REQUEST_ID = "01951111-1111-7111-8111-111111111111";
export const SEO_TEST_PAGE = "https://example.test/page";
export function focusedReport() {
  return {
    schema: "sokosumi.seo-result/1",
    requestId: SEO_TEST_REQUEST_ID,
    kind: "page_check",
    scope: {
      pageUrls: [SEO_TEST_PAGE],
      keywords: [],
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
    },
    observedAt: "2026-11-01T12:00:00.000Z",
    rulebookVersion: "test-rulebook",
    checks: [
      {
        id: "title",
        rowId: "title",
        pageUrl: SEO_TEST_PAGE,
        device: "desktop",
        result: "pass",
      },
    ],
    keywords: [],
    competitors: [],
    findings: [],
    actions: [],
    snapshotIds: ["snapshot"],
    coverage: {
      requested: ["page.inspect"],
      completed: ["page.inspect"],
      failed: [],
      skipped: [],
    },
    gaps: [],
  };
}
export function legacyReport() {
  return {
    request: { url: SEO_TEST_PAGE },
    snapshotId: "snapshot",
    rulebookVersion: "test-rulebook",
    header: {
      capturedAt: "2026-11-01T12:00:00.000Z",
      market: { country: "US", language: "en" },
      focusKeywords: [
        {
          keyword: "example",
          volume: 100,
          intent: "informational",
          position: { mobile: null, desktop: 8 },
          positionNote: {
            mobile: "not in the top 100 organic results",
            desktop: null,
          },
        },
      ],
    },
    findings: [
      {
        id: "finding",
        row: "title",
        name: "Missing title",
        level: "major",
        devices: ["desktop"],
        evidence: ["The title is empty"],
      },
    ],
    actions: [
      {
        n: 1,
        title: "Add a title",
        why: "The page has no title",
        effort: "low",
        whatToExpect: "A clearer search snippet",
        findings: ["title"],
      },
    ],
    rankingData: {
      competitors: [
        {
          url: "https://www.google.com/goto?url=example",
          source: "search",
          rank: 2,
          referringDomains: 3,
        },
      ],
      page: {
        ranked: {
          rows: [
            { keyword: "ranked term", position: 12, volume: 50, intent: null },
          ],
        },
        summary: { backlinks: 10, referring_domains: 4 },
        referringDomains: 4,
      },
      gaps: [{ keyword: "gap term", bestVolume: 30 }],
    },
    keywordOpportunities: {
      list: [
        { keyword: "opportunity", volume: 20, position: null, intent: null },
      ],
    },
    checklist: [{ row: "title", device: "desktop", result: "fired" }],
    couldNotSee: [],
  };
}
