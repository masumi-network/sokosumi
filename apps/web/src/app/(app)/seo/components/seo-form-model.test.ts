import { describe, expect, it } from "vitest";
import {
  analysisSeoBody,
  defaultFullAuditSeconds,
  editSeoCommand,
  SEO_NO_RELATED_PAGE,
  seoAnalysisMaxCredits,
  seoMainPageId,
} from "./seo-form-model";
import {
  SEO_TEST_PAGE,
  SEO_TEST_SCOPE,
  seoTestWorkspace,
} from "./seo-test-fixture";

function analysisForm() {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    kind: "rankings",
    countryCode: "DE",
    languageCode: "de",
    keywords: "stablecoins\nagent payments",
    maxProviderCalls: "4",
  }))
    form.set(name, value);
  form.append("devices", "mobile");
  form.append("devices", "desktop");
  return form;
}
describe("SEO form intent", () => {
  it("keeps the original keyword identity and version when its target page changes", () => {
    const workspace = seoTestWorkspace();
    const original = {
      id: "saved-keyword",
      keyword: "Original keyword",
      countryCode: "DE",
      languageCode: "de",
      pageUrl: workspace.pages[0].url,
      targetPageId: workspace.pages[0].id,
      saved: true,
      source: "saved",
      volume: null,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
      device: null,
      position: null,
      positionStatus: "unavailable" as const,
      checkedResults: null,
      observedAt: null,
      observationId: null,
      priority: "medium" as const,
      version: 3,
    };
    const form = new FormData();
    form.set("keyword", "A changed identity must be ignored");
    form.set("countryCode", "US");
    form.set("languageCode", "en");
    form.set("pageId", "another-page");
    form.set("priority", "high");
    expect(editSeoCommand("edit_keyword", form, workspace, original)).toEqual({
      kind: "save_keyword",
      body: {
        keyword: original.keyword,
        countryCode: "DE",
        languageCode: "de",
        pageId: "another-page",
        saved: true,
        priority: "high",
        expectedVersion: 3,
      },
    });
    form.set("pageId", "no-target-page");
    expect(
      editSeoCommand("edit_keyword", form, workspace, original).body,
    ).toMatchObject({ pageId: null, expectedVersion: 3 });
  });

  it("uses the worker's bounded time envelope for related-page audits", () => {
    expect(defaultFullAuditSeconds(2)).toBe(1170);
    expect(defaultFullAuditSeconds(10)).toBe(2850);
    expect(defaultFullAuditSeconds(100)).toBe(3600);
  });
  it("keeps selected group authority, market and the explicit request budget", () => {
    expect(analysisSeoBody(analysisForm(), seoTestWorkspace())).toMatchObject({
      scopeId: SEO_TEST_SCOPE,
      expectedScopeVersion: 2,
      countryCode: "DE",
      languageCode: "de",
      maxProviderCalls: 4,
      keywords: ["stablecoins", "agent payments"],
    });
  });
  it("never sends an executor identity from form data", () => {
    const form = analysisForm();
    form.set("coworkerId", "untrusted-task-worker");
    expect(analysisSeoBody(form, seoTestWorkspace())).not.toHaveProperty(
      "coworkerId",
    );
  });
  it.each(["rankings", "links", "audit_full", "audit_lite"])(
    "rejects unsupported paid %s even if form data includes it",
    (kind) => {
      const form = analysisForm();
      form.set("kind", kind);
      form.set("keywords", "stablecoins");
      if (kind === "audit_lite") form.append("analyses", "keyword.refresh");
      const workspace = seoTestWorkspace();
      workspace.availableActions.canUsePaidSearchData = false;
      expect(() => analysisSeoBody(form, workspace)).toThrow();
      delete workspace.availableActions.canUsePaidSearchData;
      expect(() => analysisSeoBody(form, workspace)).toThrow();
    },
  );
  it("rejects ambiguous full audits and broad scopes before requesting paid work", () => {
    const form = analysisForm();
    form.set("kind", "audit_full");
    expect(() => analysisSeoBody(form, seoTestWorkspace())).toThrow();
    form.set("kind", "rankings");
    expect(() =>
      analysisSeoBody(form, {
        ...seoTestWorkspace(),
        scope: {
          ...seoTestWorkspace().scope,
          pageIds: Array(11).fill(SEO_TEST_PAGE),
        },
      }),
    ).toThrow();
    form.set("keywords", "x".repeat(81));
    expect(() => analysisSeoBody(form, seoTestWorkspace())).toThrow();
  });
  it("uses the full-audit USD and time envelope instead of provider-call limits", () => {
    const form = analysisForm();
    form.set("kind", "audit_full");
    form.set("keywords", "stablecoins");
    form.set("usd", "1.25");
    form.set("seconds", "180");
    const workspace = seoTestWorkspace();
    workspace.scope.pageIds.push("a658c5bb-3084-4b26-81ee-b3208ee5ab61");
    const body = analysisSeoBody(form, workspace);
    expect(body.fullAuditLimits).toEqual({ usd: 1.25, seconds: 180 });
    expect(body.maxProviderCalls).toBeUndefined();
  });
  it("rejects an undersized paid request budget while allowing a zero-call page check", () => {
    const form = analysisForm();
    form.set("maxProviderCalls", "0");
    expect(() => analysisSeoBody(form, seoTestWorkspace())).toThrow(RangeError);
    form.set("kind", "page_check");
    expect(analysisSeoBody(form, seoTestWorkspace()).maxProviderCalls).toBe(0);
  });

  it.each(["page_check", "audit_lite"])(
    "never carries a stale paid-data allowance into HTML-only %s",
    (kind) => {
      const form = analysisForm();
      form.set("kind", kind);
      form.set("maxProviderCalls", "20");
      if (kind === "audit_lite") form.append("analyses", "page.inspect");
      expect(analysisSeoBody(form, seoTestWorkspace()).maxProviderCalls).toBe(
        0,
      );
      form.delete("maxProviderCalls");
      expect(analysisSeoBody(form, seoTestWorkspace()).maxProviderCalls).toBe(
        0,
      );
    },
  );

  it.each(["NaN", "Infinity", "-1", "101", "4.5"])(
    "rejects a non-finite or unbounded paid-data allowance (%s)",
    (allowance) => {
      const form = analysisForm();
      form.set("maxProviderCalls", allowance);
      expect(() => analysisSeoBody(form, seoTestWorkspace())).toThrow();
    },
  );

  it("keeps Audit Lite modules explicit and omits unused prefilled competitors", () => {
    const form = analysisForm();
    form.set("kind", "page_check");
    form.set("competitorUrls", "https://competitor.example/");
    expect(analysisSeoBody(form, seoTestWorkspace()).competitorUrls).toEqual(
      [],
    );
    form.set("kind", "audit_lite");
    form.append("analyses", "page.inspect");
    form.append("analyses", "links.refresh");
    const body = analysisSeoBody(form, seoTestWorkspace());
    expect(body.analyses).toEqual(["page.inspect", "links.refresh"]);
    expect(body.keywords).toEqual([]);
    expect(body.competitorUrls).toEqual(["https://competitor.example/"]);
  });
  it("omits a single-page full-audit limit the worker cannot honor", () => {
    const form = analysisForm();
    form.set("kind", "audit_full");
    form.set("keywords", "stablecoins");
    form.set("usd", "10");
    form.set("seconds", "120");
    const body = analysisSeoBody(form, seoTestWorkspace());
    expect(body.fullAuditLimits).toBeUndefined();
    expect(body.maxProviderCalls).toBeUndefined();
  });

  it("relates a new page to the chosen page, and to none when the user says it stands alone", () => {
    const workspace = seoTestWorkspace();
    const main = seoMainPageId(workspace);
    expect(main).toBe(workspace.pages[0].id);
    const form = new FormData();
    form.set("url", "https://example.com/pricing");
    form.set("relatedToPageId", main);
    expect(editSeoCommand("page", form, workspace).body).toMatchObject({
      relationship: "related",
      relatedToPageId: main,
    });
    form.set("relatedToPageId", SEO_NO_RELATED_PAGE);
    const alone = editSeoCommand("page", form, workspace).body;
    expect(alone).toMatchObject({ relationship: "primary" });
    expect(alone).not.toHaveProperty("relatedToPageId");
  });

  it("takes the first page that stands alone as the main page", () => {
    const workspace = seoTestWorkspace();
    const [first] = workspace.pages;
    workspace.pages = [
      {
        ...first,
        id: "related",
        relationship: "related",
        relatedToPageId: first.id,
      },
      first,
    ];
    expect(seoMainPageId(workspace)).toBe(first.id);
    workspace.pages = [];
    expect(seoMainPageId(workspace)).toBe(SEO_NO_RELATED_PAGE);
  });

  it("edits a group with its known version and selected membership", () => {
    const form = new FormData();
    form.set("name", "Search pages");
    form.append("pageIds", SEO_TEST_PAGE);
    expect(editSeoCommand("edit_scope", form, seoTestWorkspace())).toEqual({
      kind: "update_scope",
      scopeId: SEO_TEST_SCOPE,
      body: {
        name: "Search pages",
        pageIds: [SEO_TEST_PAGE],
        expectedVersion: 2,
      },
    });
  });
  it("includes the existing version when saving a previously unsaved keyword", () => {
    const workspace = seoTestWorkspace();
    workspace.keywords.push({
      id: "saved",
      keyword: "Stablecoins",
      countryCode: "DE",
      languageCode: "de",
      pageUrl: "https://example.com/",
      targetPageId: SEO_TEST_PAGE,
      saved: false,
      source: "saved",
      volume: null,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
      device: null,
      position: null,
      positionStatus: "unavailable",
      checkedResults: null,
      observedAt: null,
      observationId: null,
      priority: "medium",
      version: 3,
    });
    const form = new FormData();
    for (const [name, value] of Object.entries({
      keyword: "stablecoins",
      countryCode: "de",
      languageCode: "de",
      pageId: SEO_TEST_PAGE,
      priority: "high",
    }))
      form.set(name, value);
    expect(editSeoCommand("keyword", form, workspace)).toMatchObject({
      kind: "save_keyword",
      body: {
        expectedVersion: 3,
        countryCode: "DE",
        saved: true,
        priority: "high",
      },
    });
  });
});

describe("seoAnalysisMaxCredits", () => {
  it("shows the ceiling Core checks, and none while a limit field is not a valid value", () => {
    expect(seoAnalysisMaxCredits({ kind: "free" })).toBe(0);
    expect(seoAnalysisMaxCredits({ kind: "standard" })).toBe(50);
    expect(
      seoAnalysisMaxCredits({ kind: "full", usd: 0.33, seconds: 900 }),
    ).toBe(50);
    expect(seoAnalysisMaxCredits({ kind: "requests", count: 20 })).toBe(150);
    // A half-typed field must not throw while the person types.
    expect(
      seoAnalysisMaxCredits({ kind: "full", usd: 0, seconds: 900 }),
    ).toBeNull();
    expect(seoAnalysisMaxCredits({ kind: "requests", count: 2.5 })).toBeNull();
    // Core refuses these limits, so the dialog shows no figure for them.
    expect(
      seoAnalysisMaxCredits({ kind: "full", usd: 0.1, seconds: 900 }),
    ).toBeNull();
    expect(
      seoAnalysisMaxCredits({ kind: "full", usd: 60, seconds: 900 }),
    ).toBeNull();
    expect(seoAnalysisMaxCredits({ kind: "requests", count: 101 })).toBeNull();
    for (const seconds of [30, 4_000, 90.5])
      expect(
        seoAnalysisMaxCredits({ kind: "full", usd: 3, seconds }),
      ).toBeNull();
  });
});
