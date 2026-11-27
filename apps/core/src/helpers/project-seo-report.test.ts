import { describe, expect, it } from "vitest";
import {
  focusedRankingsReport,
  focusedReport,
  legacyReport,
  SEO_TEST_PAGE,
  SEO_TEST_REQUEST_ID,
  SEO_TEST_SECOND_PAGE,
  serpRead,
  siteStrategyReport,
} from "@/test-fixtures/project-seo";
import { withoutApprovedSearchConsole } from "./project-seo-public-report";
import {
  assertSeoArtifactMatchesRequest,
  parsePublicSeoArtifact,
  publicSeoPayloadSchema,
} from "./project-seo-report";
import {
  SEO_ALERT_ROWS_NOT_READ,
  SEO_SERPS_NOT_READ,
} from "./project-seo-report-serps";
import { SEO_STRATEGY_NOT_IMPORTED } from "./project-seo-strategy";

describe("public SEO report trust boundary", () => {
  it.each([
    ["page", legacyReport()],
    ["focused", focusedReport()],
    ["site", siteStrategyReport()],
    ["site without strategy", { ...siteStrategyReport(), strategy: undefined }],
  ])(
    "returns JSON-safe optional strategy fields for a %s audit",
    (_name, raw) => {
      const payload = parsePublicSeoArtifact(raw);
      expect(payload).not.toHaveProperty("strategyDecisions");
      expect(payload).not.toHaveProperty("decisionSources");
      expect(payload).toStrictEqual(JSON.parse(JSON.stringify(payload)));
    },
  );

  it("omits invalid difficulty from the focused keyword payload and preserves supported values", () => {
    const raw = focusedRankingsReport();
    for (const difficulty of [101, "invalid", undefined, 0, null, 55]) {
      const keyword = {
        ...raw.keywords[0],
        ...(difficulty !== undefined && { difficulty }),
      };
      const payload = parsePublicSeoArtifact({ ...raw, keywords: [keyword] });
      const stored = payload.keywords[0]!;
      if (
        difficulty === 101 ||
        difficulty === "invalid" ||
        difficulty === undefined
      )
        expect(stored).not.toHaveProperty("difficulty");
      else expect(stored.difficulty).toBe(difficulty);
      expect(payload).toStrictEqual(JSON.parse(JSON.stringify(payload)));
    }
  });
  it("keeps five ranked decisions JSON-safe when stored source references are stale", () => {
    const decisions = Array.from({ length: 5 }, (_, i) => ({
      id: `content:${i}`,
      kind: "content_opportunity",
      targetUrl: SEO_TEST_PAGE,
      action: `Revise section ${i}`,
      reason: "Reference material changed.",
      alternative: "Keep the current wording.",
      nextCheck: "Review the next crawl.",
      evidence: ["Public page capture"],
    }));
    const stored = publicSeoPayloadSchema.parse({
      ...parsePublicSeoArtifact(legacyReport()),
      strategyDecisions: decisions,
      decisionSources: [{ snapshotId: "stale" }],
    });
    expect(stored.strategyDecisions).toEqual(decisions);
    expect(stored.decisionSources ?? []).toEqual([]);
    expect(stored).toStrictEqual(JSON.parse(JSON.stringify(stored)));
  });
  it("keeps observed forum questions on an audited group and discards unsafe source links", () => {
    const raw = siteStrategyReport();
    const questions = [
      { title: "Can I cancel?", url: "https://example.test/thread" },
      { title: "When is renewal?", url: "javascript:void(0)" },
    ];
    const parsed = parsePublicSeoArtifact({
      ...raw,
      selection: {
        ...raw.selection,
        pages: raw.selection.pages.map((p) => ({ ...p, url: p.url + "#tab" })),
      },
      strategy: {
        ...raw.strategy,
        groups: raw.strategy.groups.map((g, i) => ({
          ...g,
          forums: true,
          page: i === 0 ? 1 : 999,
          forumQuestions: questions,
        })),
      },
    }).strategy;
    expect(parsed?.groups[0].forumQuestions).toStrictEqual([
      questions[0],
      { title: "When is renewal?" },
    ]);
    expect(parsed?.groups[1].forumQuestions).toBeUndefined();
    expect(parsed?.groups[0].pageUrl).toBe(SEO_TEST_PAGE);
  });
  it("links actions to their source finding IDs without mixing device-specific findings", () => {
    const raw = legacyReport();
    raw.findings = ["mobile", "desktop"].map((device) => ({
      ...raw.findings[0],
      id: `title.${device}`,
      devices: [device],
    }));
    raw.actions[0].findings = ["title.desktop"];
    const report = parsePublicSeoArtifact(raw);
    expect(report.actions[0].findingIds).toEqual(["title.desktop:desktop"]);
  });

  it("keeps an action's opening text draft or held-back note through page and site import and the stored re-parse", () => {
    const drafted = {
      target: "opening" as const,
      devices: ["mobile" as const, "desktop" as const],
      before: "Widgets for every room.",
      after: "Example Corp makes widgets for every room.",
    };
    const heldBack = {
      target: "opening" as const,
      devices: ["mobile" as const],
      heldBack: 'The draft names "Acme", which the page does not state.',
    };
    const raw = legacyReport();
    raw.actions = [
      { ...raw.actions[0], n: 1, bodyDraft: drafted },
      { ...raw.actions[0], n: 2, bodyDraft: heldBack },
      // No device: Core cannot read this draft, so it drops the draft and keeps the action.
      { ...raw.actions[0], n: 3, bodyDraft: { ...drafted, devices: [] } },
      { ...raw.actions[0], n: 4 },
      // A checked draft that also carries a held-back reason reads as held back.
      { ...raw.actions[0], n: 5, bodyDraft: { ...drafted, heldBack: "No." } },
      // These are dropped: an empty reason never makes the draft checked, nor do a repeated device or blank text.
      { ...raw.actions[0], n: 6, bodyDraft: { ...drafted, heldBack: "" } },
      {
        ...raw.actions[0],
        n: 7,
        bodyDraft: { ...drafted, devices: ["mobile", "mobile"] },
      },
      { ...raw.actions[0], n: 8, bodyDraft: { ...drafted, after: " \n" } },
    ] as typeof raw.actions;
    const drafts = (payload: { actions: { bodyDraft?: unknown }[] }) =>
      payload.actions.map((row) => row.bodyDraft);
    const expected = [
      drafted,
      heldBack,
      undefined,
      undefined,
      { target: "opening", devices: drafted.devices, heldBack: "No." },
      undefined,
      undefined,
      undefined,
    ];
    const page = parsePublicSeoArtifact(raw);
    expect(drafts(page)).toEqual(expected);
    expect(page.actions[3]).not.toHaveProperty("bodyDraft");
    // The projection reads the stored JSON with the same schema: a plain object would strip the new key.
    expect(
      drafts(publicSeoPayloadSchema.parse(JSON.parse(JSON.stringify(page)))),
    ).toEqual(expected);
    // Focused results read actions with the stored schema too: a bad draft there drops only the draft.
    const stored = JSON.parse(JSON.stringify(page));
    stored.actions[0].bodyDraft.devices = [];
    expect(drafts(publicSeoPayloadSchema.parse(stored))[0]).toBeUndefined();
    const site = parsePublicSeoArtifact({
      ...siteStrategyReport(),
      pages: [raw],
    });
    expect(drafts(site)).toEqual(expected);
  });

  it("retains site-wide findings without inventing page or device evidence", () => {
    const raw = {
      ...siteStrategyReport(),
      snapshotId: "site-snapshot",
      siteFindings: [
        {
          id: "site/IL-13",
          row: "IL-13",
          name: "Lost equity",
          level: "minor",
          devices: [],
          evidence: ["A linked URL is gone"],
          pages: [],
          findings: [],
        },
      ],
    };
    const imported = parsePublicSeoArtifact(raw);
    expect(
      imported.findings.find((row) => row.rowId === "IL-13"),
    ).toMatchObject({
      pageUrl: SEO_TEST_PAGE,
      device: null,
      evidence: ["A linked URL is gone"],
    });
    expect(imported.notes.join(" ")).toContain("Site-wide finding site/IL-13");
  });

  it("retains distinct site findings on each named page and device without duplicating merged page findings", () => {
    const page = legacyReport();
    const second = { ...page, request: { url: SEO_TEST_SECOND_PAGE } };
    const siteFinding = {
      id: "site/O-26",
      row: "O-26",
      name: "Duplicate titles",
      level: "minor",
      devices: ["mobile"],
      evidence: ["Two indexable pages share their title"],
      pages: [1, 2],
      findings: [],
    };
    const raw = {
      ...siteStrategyReport(),
      snapshotId: "site-snapshot",
      pages: [page, second],
      siteFindings: [
        siteFinding,
        { ...siteFinding, id: "site/title", findings: ["p1/finding"] },
      ],
    };
    const imported = parsePublicSeoArtifact(raw);
    const findings = imported.findings.filter((row) => row.rowId === "O-26");
    expect(findings).toHaveLength(2);
    expect(findings.map((row) => row.pageUrl)).toEqual([
      SEO_TEST_PAGE,
      SEO_TEST_SECOND_PAGE,
    ]);
    expect(new Set(imported.findings.map((row) => row.id)).size).toBe(
      imported.findings.length,
    );
    expect(findings[0]).toMatchObject({
      device: "mobile",
      severity: "minor",
      evidence: siteFinding.evidence,
      observedAt: page.header.capturedAt,
    });
    expect(
      imported.findings.filter((row) => row.rowId === "title"),
    ).toHaveLength(2);
    for (const patch of [
      { pages: [99] },
      { pages: [1, 1] },
      { devices: ["mobile", "mobile"] },
    ]) {
      expect(() =>
        parsePublicSeoArtifact({
          ...raw,
          siteFindings: [{ ...siteFinding, ...patch }],
        }),
      ).toThrow();
    }
  });

  it("keeps unrequested modules separate from individual rule check counts", () => {
    const fixture = focusedReport();
    const raw = {
      ...fixture,
      checks: ["pass", "fired", "not_checked", "blocked"].map(
        (result, index) => ({
          ...fixture.checks[0],
          id: String(index),
          result,
        }),
      ),
      coverage: {
        ...fixture.coverage,
        skipped: ["keyword.refresh", "links.refresh"],
        failed: ["page.inspect"],
        completed: [],
      },
    };

    expect(parsePublicSeoArtifact(raw).coverage).toEqual({
      checked: 2,
      skipped: 1,
      failed: 1,
      modules: {
        notRequested: 2,
        failed: 1,
        notRequestedNames: ["keyword.refresh", "links.refresh"],
        failedNames: ["page.inspect"],
      },
    });
  });

  it("retains ranked, opportunity and gap provenance without inventing rank zero", () => {
    const report = parsePublicSeoArtifact(legacyReport());
    expect(report.keywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: "example",
          device: "mobile",
          position: null,
          positionStatus: "not_in_range",
          checkedResults: 100,
        }),
        expect.objectContaining({
          keyword: "ranked term",
          device: null,
          position: 12,
          source: "ranked",
        }),
        expect.objectContaining({
          keyword: "gap term",
          position: null,
          positionStatus: "unavailable",
          source: "gap",
        }),
        expect.objectContaining({
          keyword: "opportunity",
          source: "opportunity",
        }),
      ]),
    );
    expect(report.actions[0].findingIds).toEqual(["finding:desktop"]);
    expect(report.competitors).toContainEqual(
      expect.objectContaining({
        role: "page",
        backlinks: 10,
        referringDomains: 4,
      }),
    );
  });

  it("retains the worker order up to fifty per page and excludes raw gaps from broad recommendations", () => {
    const fixture = legacyReport();
    const list = Array.from({ length: 51 }, (_, i) => ({
      ...fixture.keywordOpportunities.list[0],
      keyword: "idea " + i,
    }));
    const status = {
      status: "complete",
      proposed: 3,
      checked: 3,
      qualified: 2,
    };
    const parse = (editorialResearch?: typeof status) =>
      parsePublicSeoArtifact({
        ...fixture,
        keywordOpportunities: {
          list,
          ...(editorialResearch && { editorialResearch }),
        },
      }).keywords;
    const broad = parse(status);
    const ranked = broad.filter((row) => row.source === "opportunity");
    expect(ranked).toHaveLength(50);
    expect(ranked.at(-1)).toMatchObject({ keyword: "idea 49", ideaRank: 50 });
    expect(broad.find((row) => row.source === "gap")?.ideaRank).toBeNull();
    expect(
      parse().find((row) => row.source === "opportunity"),
    ).not.toHaveProperty("ideaRank");
  });

  it("keeps the model origins and DataForSEO receipt with the measured keyword idea", () => {
    const fixture = legacyReport();
    const editorial = {
      models: ["gemini", "codex"],
      record: "a".repeat(64),
      angle: {
        quote: "Battery condition in settings",
        nextStep:
          "Explain what each battery condition means beside the settings instructions.",
      },
    };
    const report = parsePublicSeoArtifact({
      ...fixture,
      keywordOpportunities: {
        list: [{ ...fixture.keywordOpportunities.list[0], editorial }],
      },
    });
    expect(
      report.keywords.find((row) => row.source === "opportunity")?.editorial,
    ).toEqual(editorial);
    const newer = parsePublicSeoArtifact({
      ...fixture,
      keywordOpportunities: {
        list: [
          {
            ...fixture.keywordOpportunities.list[0],
            editorial: { ...editorial, models: ["future-editor"] },
          },
        ],
      },
    });
    const ordinary = newer.keywords.find((row) => row.source === "opportunity");
    expect(ordinary).toMatchObject({
      keyword: fixture.keywordOpportunities.list[0].keyword,
    });
    expect(ordinary).not.toHaveProperty("editorial");
    expect(
      report.keywords.find((row) => row.source === "focus"),
    ).not.toHaveProperty("editorial");
  });

  it("keeps a keyword's conversion estimate and feature, and imports the report without a value it cannot read", () => {
    const fixture = legacyReport();
    const estimate = {
      conversion: "medium",
      feature: "Low battery alerts",
      intentClass: "problem",
      fit: "direct",
    };
    const report = parsePublicSeoArtifact({
      ...fixture,
      header: {
        ...fixture.header,
        focusKeywords: [{ ...fixture.header.focusKeywords[0], ...estimate }],
      },
      keywordOpportunities: {
        list: [
          { ...fixture.keywordOpportunities.list[0], ...estimate },
          {
            keyword: "unread estimate",
            volume: 10,
            position: null,
            intent: null,
            conversion: "certain",
            feature: "x".repeat(201),
          },
          {
            keyword: "blank feature",
            volume: 10,
            position: null,
            intent: null,
            conversion: "low",
            feature: "   ",
            // A class the bot takes out of the ranking is no reason Core shows.
            intentClass: "other brand",
            fit: "partial",
          },
        ],
      },
    });
    const rows = (keyword: string) =>
      report.keywords.filter((row) => row.keyword === keyword);
    // The focus keyword is one row per device; both carry the estimate.
    expect(rows("example")).toHaveLength(2);
    for (const row of [...rows("example"), ...rows("opportunity")])
      expect(row).toMatchObject(estimate);
    expect(rows("unread estimate")).toEqual([
      expect.objectContaining({ source: "opportunity", volume: 10 }),
    ]);
    expect(rows("unread estimate")[0]).not.toHaveProperty("conversion");
    expect(rows("unread estimate")[0]).not.toHaveProperty("feature");
    // A feature of spaces only is no feature: the level stays.
    expect(rows("blank feature")[0].conversion).toBe("low");
    expect(rows("blank feature")[0].feature).toBeUndefined();
    expect(rows("blank feature")[0]).not.toHaveProperty("intentClass");
    expect(rows("blank feature")[0].fit).toBe("partial");
    // A report from before the estimate has none.
    const before = parsePublicSeoArtifact(fixture);
    expect(before.keywords.every((row) => row.conversion === undefined)).toBe(
      true,
    );
  });

  it("keeps each keyword's difficulty, gives a focus keyword and a gap the one another row holds, and drops one out of range", () => {
    const fixture = legacyReport();
    const report = parsePublicSeoArtifact({
      ...fixture,
      rankingData: {
        ...fixture.rankingData,
        page: {
          ...fixture.rankingData.page,
          ranked: {
            rows: [
              {
                keyword: "ranked term",
                position: 12,
                volume: 50,
                difficulty: 30,
                intent: null,
              },
              // Another spelling of the focus keyword: it gives the focus rows their difficulty.
              {
                keyword: "Example",
                position: 40,
                volume: 90,
                difficulty: 55,
                intent: null,
              },
            ],
          },
        },
      },
      keywordOpportunities: {
        list: [
          {
            keyword: "opportunity",
            volume: 20,
            difficulty: 140,
            position: null,
            intent: null,
          },
        ],
      },
      keywordData: { facts: { keyword: "gap term", keyword_difficulty: 12 } },
    });
    const difficulty = (keyword: string) =>
      report.keywords
        .filter((row) => row.keyword === keyword)
        .map((row) => row.difficulty);
    expect(difficulty("example")).toEqual([55, 55]);
    expect(difficulty("ranked term")).toEqual([30]);
    expect(difficulty("gap term")).toEqual([12]);
    // 140 is no difficulty: the row stays, without one.
    expect(difficulty("opportunity")).toEqual([null]);
    // A report from before difficulty has none.
    expect(
      parsePublicSeoArtifact(fixture).keywords.every(
        (row) => row.difficulty === null,
      ),
    ).toBe(true);
  });

  it("imports a focused result that carries an estimate, and does not read the estimate", () => {
    const fixture = focusedReport();
    const report = parsePublicSeoArtifact({
      ...fixture,
      keywords: [
        {
          keyword: "example",
          pageUrl: SEO_TEST_PAGE,
          device: "desktop",
          position: 4,
          positionStatus: "ranked",
          checkedResults: 100,
          sourceRef: "snapshot",
          observedAt: fixture.observedAt,
          conversion: "certain",
          feature: 7,
          intentClass: 7,
          fit: "direct",
        },
      ],
    });
    expect(report.keywords).toEqual([
      expect.objectContaining({ keyword: "example", position: 4 }),
    ]);
    expect(report.keywords[0]).not.toHaveProperty("conversion");
    expect(report.keywords[0]).not.toHaveProperty("feature");
    expect(report.keywords[0]).not.toHaveProperty("intentClass");
    expect(report.keywords[0]).not.toHaveProperty("fit");
  });

  it("refuses private Google evidence before projecting public fields, including nested site pages", () => {
    expect(() =>
      parsePublicSeoArtifact({
        ...legacyReport(),
        outcomeReading: { clicks: 3 },
      }),
    ).toThrow("Only public SEO evidence");
    expect(() =>
      parsePublicSeoArtifact({
        kind: "site",
        rulebookVersion: "test",
        pages: [
          {
            ...legacyReport(),
            request: { url: SEO_TEST_PAGE, connections: ["search_console"] },
          },
        ],
      }),
    ).toThrow("Only public SEO evidence");
    const report = legacyReport();
    expect(() =>
      parsePublicSeoArtifact({
        ...report,
        header: {
          ...report.header,
          focusKeywords: [
            { ...report.header.focusKeywords[0], searchConsole: { clicks: 1 } },
          ],
        },
      }),
    ).toThrow("Private search evidence");
  });

  it("drops only Search Console sections for an approved audit and still refuses other private evidence", () => {
    const page = (request: Record<string, unknown>, extra = {}) => ({
      kind: "site",
      rulebookVersion: "test",
      pages: [{ ...legacyReport(), request, ...extra }],
    });
    const decisions = {
      privateStrategyDecisions: [{ decision: "fixture-strategy-marker" }],
    };
    const approved = withoutApprovedSearchConsole({
      ...page(
        { url: SEO_TEST_PAGE, connections: ["search_console"] },
        { searchConsole: { clicks: 1 }, searchConsoleNear: [], ...decisions },
      ),
      ...decisions,
    });
    expect(parsePublicSeoArtifact(approved).pageUrls).toEqual([SEO_TEST_PAGE]);
    expect(JSON.stringify(approved)).not.toContain("fixture-strategy-marker");
    expect(() =>
      parsePublicSeoArtifact({ ...page({ url: SEO_TEST_PAGE }), ...decisions }),
    ).toThrow("Only public SEO evidence");
    for (const report of [
      page({ url: SEO_TEST_PAGE, connections: ["search_console", "bing"] }),
      page({ url: SEO_TEST_PAGE }, { bing: { clicks: 1 } }),
      page({ url: SEO_TEST_PAGE }, { outcomeReading: { clicks: 1 } }),
    ])
      expect(() =>
        parsePublicSeoArtifact(withoutApprovedSearchConsole(report)),
      ).toThrow("Only public SEO evidence");
  });

  it("imports a site audit whose failed page the worker names as skipped, and refuses one that drops a page silently", () => {
    const second = "https://example.test/second";
    const site = (skipped: { url: string; reason: string }[]) => ({
      kind: "site",
      rulebookVersion: "test",
      pages: [legacyReport()],
      selection: { pages: [], skipped, picked: [] },
    });
    const request = {
      id: SEO_TEST_REQUEST_ID,
      kind: "audit_full",
      request: {
        pageUrls: [SEO_TEST_PAGE, second],
        countryCode: "US",
        languageCode: "en",
      },
    };
    const partial = site([
        { url: second, reason: "the page Run failed: timeout" },
      ]),
      parsed = parsePublicSeoArtifact(partial);
    expect(parsed.pageUrls).toEqual([SEO_TEST_PAGE]);
    expect(parsed.notes).toContain(
      `Page not audited: ${second} (the page Run failed: timeout)`,
    );
    expect(parsed.strategy).toBeUndefined();
    expect(parsed.notes).not.toContain(SEO_STRATEGY_NOT_IMPORTED);
    expect(() =>
      assertSeoArtifactMatchesRequest(partial, parsed, request),
    ).not.toThrow();
    const silent = site([]);
    expect(() =>
      assertSeoArtifactMatchesRequest(
        silent,
        parsePublicSeoArtifact(silent),
        request,
      ),
    ).toThrow("frozen page scope");
    for (const skipped of [
      { url: SEO_TEST_PAGE, reason: "reported too" },
      { url: "https://other.test/x", reason: "out of scope" },
    ]) {
      const odd = site([{ url: second, reason: "timeout" }, skipped]);
      expect(() =>
        assertSeoArtifactMatchesRequest(
          odd,
          parsePublicSeoArtifact(odd),
          request,
        ),
      ).toThrow("frozen page scope");
    }
  });

  it("imports the pages a full audit added, up to the count its frozen request names", () => {
    const added = "https://shop.example.test/added",
      other = "https://example.test/other";
    const site = (
      urls: string[],
      skipped: { url: string; reason: string }[] = [],
    ) => ({
      kind: "site",
      rulebookVersion: "test",
      pages: urls.map((url) => ({ ...legacyReport(), request: { url } })),
      selection: { pages: [], skipped, picked: [] },
    });
    const check = (raw: ReturnType<typeof site>, autoPages?: number) =>
      assertSeoArtifactMatchesRequest(raw, parsePublicSeoArtifact(raw), {
        id: SEO_TEST_REQUEST_ID,
        kind: "audit_full",
        request: {
          pageUrls: [SEO_TEST_PAGE],
          countryCode: "US",
          languageCode: "en",
          ...(autoPages ? { autoPages } : {}),
        },
      });
    const one = site([SEO_TEST_PAGE, added]),
      failed = site(
        [SEO_TEST_PAGE, added],
        [{ url: other, reason: "the page Run failed: timeout" }],
      );
    // The evidence of an added page is inside the scope: the fixture page has a finding and an action.
    expect(parsePublicSeoArtifact(one).pageUrls).toEqual([
      SEO_TEST_PAGE,
      added,
    ]);
    expect(() => check(one, 1)).not.toThrow();
    // An added page that failed counts too: the worker paid for its try.
    expect(() => check(failed, 2)).not.toThrow();
    expect(() => check(failed, 1)).toThrow("frozen page scope");
    expect(() => check(one)).toThrow("frozen page scope");
    // The selected page stays required, with or without added pages.
    expect(() => check(site([added]), 4)).toThrow("frozen page scope");
  });

  it("keeps a site audit's strategy results: page per keyword group, and only web links as targets", () => {
    expect(parsePublicSeoArtifact(siteStrategyReport()).strategy).toEqual({
      verdict: "keep",
      why: "160 of 160 monthly searches lie in groups the site can reach.",
      groups: [
        {
          keywords: ["example"],
          lead: "example",
          pageUrl: SEO_TEST_PAGE,
          volume: 140,
          recent: 47,
          trend: "falling",
          forums: true,
          reach: "in reach",
          position: null,
        },
        {
          keywords: ["second term"],
          lead: "second term",
          pageUrl: SEO_TEST_SECOND_PAGE,
          volume: 20,
          recent: null,
          trend: null,
          reach: "open",
          position: 4,
        },
        {
          // A group without a page number is the start page's.
          keywords: ["site term"],
          lead: "site term",
          pageUrl: SEO_TEST_PAGE,
          volume: null,
          recent: null,
          trend: null,
          forums: true,
          reach: "not determined",
          position: null,
        },
      ],
      actions: [
        {
          kind: "get listed",
          title: "Ask to be added to these lists of products",
          why: "2 lists of products are in the top 10.",
          expectedEffect: "People who compare products can find the product.",
          effort: "medium",
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
              url: "https://store.test/app",
              title: null,
              type: "app store",
              serps: 1,
              state: null,
            },
          ],
        },
      ],
    });
  });

  it("keeps a keyword group whose page the page selection does not name", () => {
    const report = siteStrategyReport();
    report.selection.pages = [];
    expect(
      parsePublicSeoArtifact(report).strategy?.groups.map(
        (group) => group.pageUrl,
      ),
    ).toEqual([null, null, null]);
  });

  it("keeps a promotion action's place and text; a place that is no web link goes with its text, and the action stays", () => {
    const base = siteStrategyReport();
    const promote = {
      ...base.strategy.actions[0],
      kind: "promote",
      targets: [],
      place: {
        name: "r/example",
        url: "https://www.reddit.com/r/example/",
        form: "community",
      },
      draft: "I make Example.\n\nIt does one thing.",
    };
    const actions = parsePublicSeoArtifact({
      ...base,
      strategy: {
        ...base.strategy,
        actions: [
          promote,
          {
            ...promote,
            place: { ...promote.place, url: "javascript:alert(1)" },
          },
          {
            ...promote,
            place: { ...promote.place, name: " " },
            draft: "x".repeat(3001),
          },
          { ...promote, place: null, draft: null },
          // A form of the fields that Core cannot read.
          { ...promote, place: "r/example", draft: 5 },
          { ...promote, place: { ...promote.place, form: "x".repeat(101) } },
          // 1500 characters of 2 UTF-16 units each: the longest text the bot writes.
          { ...promote, draft: "\u{1F600}".repeat(1500) },
          { ...promote, draft: " \n" },
        ],
      },
    }).strategy?.actions;
    expect(actions?.[0]).toMatchObject({
      kind: "promote",
      place: promote.place,
      draft: promote.draft,
    });
    expect(actions?.[1]).toMatchObject({ kind: "promote" });
    expect(actions?.[1].place).toBeUndefined();
    expect(actions?.[1].draft).toBeUndefined();
    // A blank name shows the address. A text longer than the bot writes, or a null, loses the text only.
    expect(actions?.[2].place?.name).toBe(promote.place.url);
    expect(actions?.[2].draft).toBeUndefined();
    expect(actions?.[3]).toMatchObject({ kind: "promote" });
    expect(actions?.[3].place).toBeUndefined();
    expect(actions?.[3].draft).toBeUndefined();
    // Core kept neither field before, so a form it cannot read loses the place and its text, not the strategy.
    for (const row of [4, 5]) {
      expect(actions?.[row]).toMatchObject({ kind: "promote" });
      expect(actions?.[row].place).toBeUndefined();
      expect(actions?.[row].draft).toBeUndefined();
    }
    expect(actions?.[6].draft).toHaveLength(3000);
    expect(actions?.[7].place).toEqual(promote.place);
    expect(actions?.[7].draft).toBeUndefined();
  });

  it("keeps the place notes one per line; a note in a form Core cannot read is dropped, not the strategy", () => {
    const base = siteStrategyReport();
    const notes = (placesNote: unknown) =>
      parsePublicSeoArtifact({
        ...base,
        strategy: { ...base.strategy, placesNote },
      }).strategy;
    expect(
      notes(
        "the place_fit agent gave no answer for r/mac, so it shows without a ready text; discussions.apple.com is in 3 of 9 SERP reads, but its terms ban promotion (https://discussions.apple.com/terms), so it is no place",
      )?.placesNotes,
    ).toEqual([
      "the place_fit agent gave no answer for r/mac, so it shows without a ready text",
      "discussions.apple.com is in 3 of 9 SERP reads, but its terms ban promotion (https://discussions.apple.com/terms), so it is no place",
    ]);
    // Blank lines and a line longer than the payload allows go; the rest of the strategy stays.
    expect(notes(` ; ${"x".repeat(20_001)}; ok`)?.placesNotes).toEqual(["ok"]);
    for (const other of [undefined, null, "", 5, ["a"]]) {
      expect(notes(other)?.verdict).toBe(base.strategy.verdict);
      expect(notes(other)?.placesNotes).toBeUndefined();
    }
    expect(
      notes(Array.from({ length: 30 }, (_, n) => `note ${n}`).join("; "))
        ?.placesNotes,
    ).toHaveLength(20);
    // The bot's list keeps a note whole, also one with "; " in its error text; an entry that is no text goes.
    const listed = (placesNotes: unknown) =>
      parsePublicSeoArtifact({
        ...base,
        strategy: { ...base.strategy, placesNotes, placesNote: "old; line" },
      }).strategy?.placesNotes;
    expect(
      listed(["the place_fit agent failed: 429; retry later", 5, " ", "b"]),
    ).toEqual(["the place_fit agent failed: 429; retry later", "b"]);
    // A list in a form Core cannot read, or with no note it can keep, falls back to the joined line.
    for (const other of ["x", [], [null, " "]])
      expect(listed(other)).toEqual(["old", "line"]);
  });

  it("imports the audit with a note when it cannot read the strategy section", () => {
    for (const broken of [
      { verdict: "keep" },
      {
        ...siteStrategyReport().strategy,
        why: "x".repeat(20_001),
      },
    ]) {
      const parsed = parsePublicSeoArtifact({
        ...siteStrategyReport(),
        strategy: broken,
      });
      expect(parsed.strategy).toBeUndefined();
      expect(parsed.notes).toContain(SEO_STRATEGY_NOT_IMPORTED);
      expect(parsed.pageUrls).toEqual([SEO_TEST_PAGE]);
      expect(parsed.findings).toHaveLength(1);
    }
  });

  it("rejects a valid result relabeled for a different Market, device, keyword or external target", () => {
    const raw = focusedReport(),
      parsed = parsePublicSeoArtifact(raw);
    const request = {
      id: SEO_TEST_REQUEST_ID,
      kind: "page_check",
      request: {
        pageUrls: [SEO_TEST_PAGE],
        keywords: [],
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop"],
      },
    };
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, parsed, request),
    ).not.toThrow();
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, parsed, {
        ...request,
        request: { ...request.request, countryCode: "DE" },
      }),
    ).toThrow("Market");
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, parsed, {
        ...request,
        request: { ...request.request, devices: ["mobile"] },
      }),
    ).toThrow("devices");
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, parsed, {
        ...request,
        request: { ...request.request, keywords: ["unrequested"] },
      }),
    ).toThrow("keywords");
    expect(() =>
      assertSeoArtifactMatchesRequest(
        raw,
        {
          ...parsed,
          competitors: [
            {
              pageUrl: "https://unapproved.test/",
              role: "competitor",
              backlinks: 1,
              referringDomains: 1,
              sourceRef: "snapshot",
              observedAt: raw.observedAt,
            },
          ],
        },
        request,
      ),
    ).toThrow("unapproved link target");
  });
});

describe("SERP reads of a focused result", () => {
  const rankingsRequest = {
    id: SEO_TEST_REQUEST_ID,
    kind: "rankings",
    request: {
      pageUrls: [SEO_TEST_PAGE],
      keywords: ["example"],
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
    },
  };

  it("keeps serps and alertRows through import and the stored re-parse", () => {
    const raw = focusedRankingsReport(),
      parsed = parsePublicSeoArtifact(raw);
    expect(parsed.serps).toEqual([serpRead()]);
    expect(parsed.alertRows).toEqual(["M-01"]);
    // The projection reads the stored JSON with the same schema: a plain object would strip the new keys.
    const stored = publicSeoPayloadSchema.parse(
      JSON.parse(JSON.stringify(parsed)),
    );
    expect(stored.serps).toEqual([serpRead()]);
    expect(stored.alertRows).toEqual(["M-01"]);
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, parsed, rankingsRequest),
    ).not.toThrow();
  });

  it("parses an older result without serps, with no field and no note", () => {
    const { serps: _serps, alertRows: _rows, ...old } = focusedRankingsReport();
    const parsed = parsePublicSeoArtifact(old);
    expect(parsed.serps).toBeUndefined();
    expect(parsed.alertRows).toBeUndefined();
    expect(parsed.notes).toEqual([]);
    expect(parsed.keywords).toHaveLength(1);
  });

  it("drops an unreadable SERP read with a note and keeps the readable ones and the paid positions", () => {
    for (const bad of [
      serpRead({ aiOverview: { shown: true } }),
      serpRead({ top: [{ rank: 0, domain: "a.test" }] }),
      // Out of scope, but unreadable: it is dropped before the scope check sees it.
      serpRead({ device: "tablet", keyword: "unrequested" }),
    ]) {
      const raw = {
        ...focusedRankingsReport(),
        serps: [bad, serpRead({ device: "desktop" })],
      };
      const parsed = parsePublicSeoArtifact(raw);
      expect(parsed.serps).toEqual([serpRead({ device: "desktop" })]);
      expect(parsed.notes).toEqual([SEO_SERPS_NOT_READ]);
      expect(parsed.keywords[0]).toMatchObject({ position: 2 });
      expect(() =>
        assertSeoArtifactMatchesRequest(raw, parsed, rankingsRequest),
      ).not.toThrow();
    }
    const notList = parsePublicSeoArtifact({
      ...focusedRankingsReport(),
      serps: "not a list",
    });
    expect(notList.serps).toBeUndefined();
    expect(notList.notes).toEqual([SEO_SERPS_NOT_READ]);
  });

  it("drops unreadable alert rows with their own note", () => {
    const parsed = parsePublicSeoArtifact({
      ...focusedRankingsReport(),
      alertRows: [42],
    });
    expect(parsed.alertRows).toBeUndefined();
    expect(parsed.serps).toHaveLength(1);
    expect(parsed.notes).toEqual([SEO_ALERT_ROWS_NOT_READ]);
  });

  it("keeps an AI Overview citation that the read could not determine", () => {
    const aiOverview = {
      shown: true,
      asyncLoaded: false,
      citedDomains: ["google.com"],
      pageCited: null,
    };
    const parsed = parsePublicSeoArtifact({
      ...focusedRankingsReport(),
      serps: [serpRead({ aiOverview })],
    });
    expect(parsed.notes).toEqual([]);
    expect(parsed.serps?.[0].aiOverview).toEqual(aiOverview);
  });

  it("keeps the site citation through import and the stored re-parse, and reads an older read without it", () => {
    const cited = {
      shown: true,
      asyncLoaded: true,
      citedDomains: ["example.com"],
      pageCited: false,
    };
    const parsed = parsePublicSeoArtifact({
      ...focusedRankingsReport(),
      serps: [
        serpRead({ aiOverview: { ...cited, siteCited: true } }),
        serpRead({ aiOverview: cited }),
      ],
    });
    const stored = publicSeoPayloadSchema.parse(
      JSON.parse(JSON.stringify(parsed)),
    );
    expect(parsed.notes).toEqual([]);
    expect(stored.serps?.map((read) => read.aiOverview)).toEqual([
      { ...cited, siteCited: true },
      cited,
    ]);
  });

  it("keeps a null AI Overview as not checked and a null featured snippet as none", () => {
    const parsed = parsePublicSeoArtifact({
      ...focusedRankingsReport(),
      serps: [serpRead({ aiOverview: null, featured: null })],
    });
    expect(parsed.serps?.[0]).toMatchObject({
      aiOverview: null,
      featured: null,
    });
  });

  it("rejects a SERP read of an unrequested keyword or device", () => {
    for (const row of [
      serpRead({ keyword: "unrequested" }),
      serpRead({ device: "mobile" }),
    ]) {
      const raw = { ...focusedRankingsReport(), serps: [row] };
      expect(() =>
        assertSeoArtifactMatchesRequest(
          raw,
          parsePublicSeoArtifact(raw),
          rankingsRequest,
        ),
      ).toThrow("unrequested keywords or devices");
    }
  });
});

it("rejects owner-only Bing evidence in a full page or a nested site result before importing decisions", () => {
  const bing = { property: "owner.test", queries: [{ key: "private term" }] };
  const page = { ...legacyReport(), bing };
  for (const raw of [page, { ...siteStrategyReport(), pages: [page] }]) {
    expect(() => parsePublicSeoArtifact(raw)).toThrow(
      "Only public SEO evidence",
    );
  }
});

it("uses only exact public sitemap roots from the first page of a delivered audit", () => {
  const url = new URL("/maps/index.xml", SEO_TEST_PAGE).href;
  const page = { ...legacyReport(), publicSitemaps: [url] };
  expect(parsePublicSeoArtifact(page).publicSitemaps).toEqual([url]);
  const site = {
    ...siteStrategyReport(),
    pages: [
      page,
      {
        ...legacyReport(),
        publicSitemaps: [new URL("/other.xml", SEO_TEST_PAGE).href],
      },
    ],
  };
  expect(parsePublicSeoArtifact(site).publicSitemaps).toEqual([url]);
  for (const value of [
    [url + "?session=abc"],
    ["https://foreign.test/sitemap.xml"],
    [new URL("/admin/map.xml", SEO_TEST_PAGE).href],
  ]) {
    expect(
      parsePublicSeoArtifact({ ...page, publicSitemaps: value }).publicSitemaps,
    ).toBeUndefined();
  }
});

it("accepts a www homepage root only when the delivery reports the verified mobile final URL", () => {
  const page = legacyReport(),
    home = "https://example.test/",
    twin = "https://www.example.test/";
  const input = {
    ...page,
    request: { ...page.request, url: home },
    publicSitemaps: [twin + "map.xml"],
  };
  expect(parsePublicSeoArtifact(input).publicSitemaps).toBeUndefined();
  expect(
    parsePublicSeoArtifact({
      ...input,
      header: { ...page.header, finalUrl: { mobile: twin } },
    }).publicSitemaps,
  ).toEqual(input.publicSitemaps);
  expect(
    parsePublicSeoArtifact({
      ...input,
      header: { ...page.header, finalUrl: { mobile: twin + "pricing" } },
    }).publicSitemaps,
  ).toBeUndefined();
});
