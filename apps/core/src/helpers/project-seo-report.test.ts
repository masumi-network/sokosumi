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

  it("keeps a keyword's conversion estimate and feature, and imports the report without a value it cannot read", () => {
    const fixture = legacyReport();
    const estimate = { conversion: "medium", feature: "Low battery alerts" };
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
    expect(rows("unread estimate")[0].conversion).toBeUndefined();
    expect(rows("unread estimate")[0].feature).toBeUndefined();
    // A feature of spaces only is no feature: the level stays.
    expect(rows("blank feature")[0].conversion).toBe("low");
    expect(rows("blank feature")[0].feature).toBeUndefined();
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
        },
      ],
    });
    expect(report.keywords).toEqual([
      expect.objectContaining({ keyword: "example", position: 4 }),
    ]);
    expect(report.keywords[0]).not.toHaveProperty("conversion");
    expect(report.keywords[0]).not.toHaveProperty("feature");
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
