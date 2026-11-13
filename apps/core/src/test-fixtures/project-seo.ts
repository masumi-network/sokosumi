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
export const SEO_TEST_SECOND_PAGE = "https://example.test/second";
const reachRead = {
  featured: false,
  pageDomains: 2,
  weakest: null,
  counted: 1,
  top: 7,
  forums: true,
};
/** A site report with a strategy block as the worker writes it, with fields Core does not keep. */
export function siteStrategyReport() {
  return {
    kind: "site",
    rulebookVersion: "test-rulebook",
    pages: [legacyReport()],
    selection: {
      pages: [
        { n: 1, url: SEO_TEST_PAGE, role: "start" },
        { n: 2, url: SEO_TEST_SECOND_PAGE, role: "feature" },
      ],
      skipped: [],
      picked: [],
    },
    strategy: {
      verdict: "keep",
      why: "160 of 160 monthly searches lie in groups the site can reach.",
      groups: [
        {
          ...reachRead,
          keywords: ["example"],
          lead: "example",
          page: 1,
          volume: 140,
          recent: 47,
          trend: "falling",
          demand: 47,
          reach: "in reach",
          position: null,
        },
        {
          ...reachRead,
          keywords: ["second term"],
          lead: "second term",
          page: 2,
          volume: 20,
          recent: null,
          trend: null,
          demand: 20,
          reach: "open",
          position: 4,
        },
        {
          ...reachRead,
          keywords: ["site term"],
          lead: "site term",
          volume: null,
          recent: null,
          trend: null,
          demand: null,
          reach: "not determined",
          position: null,
        },
      ],
      openings: [],
      actions: [
        {
          kind: "get listed",
          title: "Ask to be added to these lists of products",
          why: "2 lists of products are in the top 10.",
          whatToExpect: "People who compare products can find the product.",
          effort: "medium",
          category: "listings",
          limit: "Ask on the product's merits only.",
          targets: [
            {
              url: "https://lists.test/best",
              title: "Best apps",
              type: "listicle",
              serps: 2,
              state: "not mentioned",
            },
            {
              url: "javascript:alert(1)",
              title: null,
              type: "other",
              serps: 1,
            },
            // Short enough as text, too long once the address is encoded.
            {
              url: `https://long.test/${"\u00e9".repeat(1000)}`,
              title: null,
              type: "other",
              serps: 1,
            },
            // The worker keeps a result whose address does not parse.
            { url: "example.com/x", title: null, type: "other", serps: 1 },
            {
              url: "https://user:secret@lists.test/private",
              title: null,
              type: "other",
              serps: 1,
            },
            {
              // A no-break space: the URL check trims it, `new URL` does not.
              url: "\u00a0https://store.test/app",
              title: null,
              type: "app store",
              serps: 1,
            },
          ],
        },
      ],
      markets: { rows: [] },
    },
  };
}
/** One SERP read in the shape of seo-bot `AnalysisReport.serps[]`. */
export function serpRead(overrides: Record<string, unknown> = {}) {
  return {
    keyword: "example",
    device: "desktop",
    sourceRef: "snapshot:serp:desktop",
    observedAt: "2026-11-01T12:00:00.000Z",
    itemTypes: [
      "ai_overview",
      "featured_snippet",
      "organic",
      "people_also_ask",
    ],
    aiOverview: {
      shown: true,
      asyncLoaded: false,
      citedDomains: ["example.test", "rival.test"],
      pageCited: true,
    },
    featured: { domain: "rival.test", pageOwned: false },
    paaOwned: true,
    top: [
      { rank: 1, domain: "rival.test" },
      { rank: 2, domain: "example.test" },
      { rank: 3, domain: null },
    ],
    suspect: false,
    ...overrides,
  };
}
/** A focused rankings result with one position read and its SERP read. */
export function focusedRankingsReport() {
  const base = focusedReport();
  return {
    ...base,
    kind: "rankings",
    scope: { ...base.scope, keywords: ["example"] },
    checks: [],
    keywords: [
      {
        keyword: "example",
        pageUrl: SEO_TEST_PAGE,
        device: "desktop",
        position: 2,
        positionStatus: "ranked",
        checkedResults: 100,
        sourceRef: "snapshot:serp:desktop",
        observedAt: base.observedAt,
      },
    ],
    coverage: { ...base.coverage, requested: ["keyword.refresh"] },
    serps: [serpRead()],
    alertRows: ["M-01"],
  };
}
