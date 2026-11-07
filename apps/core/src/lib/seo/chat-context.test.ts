import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";
import { parseSeoChatReply, seoChatContext } from "./chat-context";

function workspaceFixture(): ProjectSeoWorkspace {
  const pageId = randomUUID();
  const now = new Date().toISOString();
  return {
    auditId: randomUUID(),
    auditName: "Saved pages",
    projectId: null,
    websiteUrl: null,
    scope: {
      id: null,
      name: "All pages",
      version: 0,
      pageIds: [pageId],
      from: null,
      to: null,
    },
    pages: [
      {
        id: pageId,
        url: "https://example.test/",
        label: "",
        relationship: "primary",
        relatedToPageId: null,
        createdAt: now,
      },
    ],
    scopes: [],
    observations: [],
    history: { limit: 100, limited: false },
    keywords: [],
    competitors: [],
    findings: [],
    actions: [],
    metricsStatus: "available",
    searchQueries: null,
    metrics: [
      {
        id: "views",
        key: "page_views",
        label: "Page views",
        unit: "count",
        source: "ga4",
        propertyId: "properties/123",
        value: 321,
        from: "2026-11-01",
        to: "2026-11-02",
        timeZone: "UTC",
        channel: "all",
        observedAt: now,
        coverage: "complete",
        points: [],
        notes: [],
      },
    ],
    timeline: [],
    analyses: [],
    monitors: [],
    availableActions: {
      canEdit: true,
      canRequestAnalysis: false,
      canSyncMetrics: true,
    },
  };
}

describe("native audit chat inference boundary", () => {
  it("separates rule checks from unrequested analysis modules in chat evidence", () => {
    const workspace = workspaceFixture();
    workspace.observations = [
      {
        id: randomUUID(),
        kind: "page_check",
        source: "seo_coworker",
        observedAt: "2026-11-01T12:00:00.000Z",
        pageIds: workspace.scope.pageIds,
        scopeVersion: 0,
        sourceTaskId: null,
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop"],
        rulebookVersion: "test",
        artifactHash: "hash",
        coverage: {
          checked: 12,
          skipped: 0,
          failed: 0,
          modules: {
            notRequested: 2,
            failed: 0,
            notRequestedNames: ["keyword.refresh", "links.refresh"],
            failedNames: [],
          },
        },
      },
    ];
    const evidence = JSON.parse(seoChatContext(workspace));
    expect(evidence.observations[0]).toMatchObject({
      ruleChecks: { checked: 12, notChecked: 0, unavailable: 0 },
      analysisModules: {
        notRequested: 2,
        failed: 0,
        notRequestedNames: ["keyword.refresh", "links.refresh"],
        failedNames: [],
      },
    });
    expect(evidence.observations[0]).not.toHaveProperty("coverage");
  });

  it("keeps confirmed issues ahead of neutral measurements when evidence is limited", () => {
    const workspace = workspaceFixture();
    const measurement = {
      id: "measurement",
      observationId: randomUUID(),
      pageUrl: workspace.pages[0].url,
      device: "desktop" as const,
      rowId: "O-06",
      title: "Title length",
      severity: "measure" as const,
      evidence: ["The title contains 56 characters"],
      sourceRef: "synthetic-html",
      observedAt: new Date().toISOString(),
    };
    workspace.findings = [
      ...Array.from({ length: 20 }, (_, index) => ({
        ...measurement,
        id: `measurement-${index}`,
      })),
      {
        ...measurement,
        id: "indexing",
        rowId: "AC-05",
        title: "Indexing instruction",
        severity: "critical",
        evidence: ["The fetched HTML includes noindex"],
      },
    ];
    const evidence = JSON.parse(seoChatContext(workspace));
    expect(evidence.findings[0]).toMatchObject({
      title: "Indexing instruction",
      severity: "critical",
    });
    expect(evidence.limited).toBe(true);
    expect(evidence.totals.findings).toBe(21);
  });

  it("keeps the audited page distinct from competing pages in chat evidence", () => {
    const workspace = workspaceFixture();
    const measured = {
      id: "own-page",
      url: workspace.pages[0].url,
      role: "page" as const,
      countryCode: "US",
      languageCode: "en",
      scopeVersion: 0,
      observationId: randomUUID(),
      rank: null,
      backlinks: 30,
      referringDomains: 4,
      source: "backlinks",
      observedAt: new Date().toISOString(),
      confirmed: false,
      canConfirm: false,
      version: 1,
      exclusionReason: null,
    };
    workspace.competitors = [
      measured,
      {
        ...measured,
        id: "other-page",
        url: "https://other.test/",
        role: "competitor",
        canConfirm: true,
      },
    ];
    const evidence = JSON.parse(seoChatContext(workspace));
    expect(evidence.totals.competitors).toBe(1);
    expect(evidence.competitors).toMatchObject([
      { url: workspace.pages[0].url, role: "page", backlinks: 30 },
      { url: "https://other.test/", role: "competitor", backlinks: 30 },
    ]);
  });

  it("distinguishes an observed ranking page from the saved target without inventing saved-only observations", () => {
    const workspace = workspaceFixture();
    const target = workspace.pages[0];
    const observed = {
      ...target,
      id: randomUUID(),
      url: "https://example.test/ranking-page",
    };
    workspace.pages.push(observed);
    workspace.scope.pageIds.push(observed.id);
    const keyword = {
      id: "observed-keyword",
      keyword: "observed keyword",
      pageUrl: observed.url,
      targetPageId: target.id,
      saved: true,
      countryCode: "US",
      languageCode: "en",
      source: "rank_refresh",
      volume: 100,
      intent: null,
      device: "desktop" as const,
      position: 4,
      positionStatus: "ranked" as const,
      checkedResults: 100,
      observedAt: new Date().toISOString(),
      observationId: randomUUID(),
      priority: "high" as const,
      version: 2,
    };
    workspace.keywords = [
      keyword,
      {
        ...keyword,
        id: "saved-keyword",
        keyword: "saved keyword",
        pageUrl: target.url,
        source: "saved",
        observationId: null,
        observedAt: null,
        device: null,
        position: null,
        positionStatus: "unavailable",
        checkedResults: null,
        volume: null,
      },
      {
        ...keyword,
        id: "unavailable-target",
        keyword: "unavailable target",
        targetPageId: randomUUID(),
      },
    ];
    const evidence = JSON.parse(seoChatContext(workspace));
    expect(evidence.keywords).toMatchObject([
      {
        keyword: "observed keyword",
        observedPageUrl: observed.url,
        targetPageId: target.id,
        targetPageUrl: target.url,
      },
      {
        keyword: "saved keyword",
        observedPageUrl: null,
        targetPageId: target.id,
        targetPageUrl: target.url,
      },
      {
        keyword: "unavailable target",
        observedPageUrl: observed.url,
        targetPageId: null,
        targetPageUrl: null,
      },
    ]);
    expect(
      evidence.keywords.every(
        (row: Record<string, unknown>) => !("pageUrl" in row),
      ),
    ).toBe(true);
  });

  it("keeps statistics and dispatch state in valid bounded JSON despite a large history", () => {
    const workspace = workspaceFixture();
    workspace.observations = Array.from({ length: 100 }, () => ({
      id: randomUUID(),
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date().toISOString(),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 0,
      sourceTaskId: null,
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
      rulebookVersion: "a".repeat(20_000),
      artifactHash: "hash",
      coverage: { checked: 1, skipped: 0, failed: 0 },
    }));
    const encoded = seoChatContext(workspace);
    const evidence = JSON.parse(encoded);
    expect(encoded.length).toBeLessThanOrEqual(30_000);
    expect(evidence).toMatchObject({
      metricsStatus: "available",
      searchQueries: null,
      analysisDispatchEnabled: false,
      limited: true,
      totals: { observations: 100 },
      metrics: [{ key: "page_views", value: 321 }],
    });
    expect(evidence.observations.length).toBeLessThan(100);
  });

  it("keeps review opportunities in chat evidence behind many fixes", () => {
    const workspace = workspaceFixture();
    const action = (kind: "fix" | "opportunity", index: number) => ({
      id: `${kind}-${index}`,
      observationId: randomUUID(),
      pageUrl: "https://example.com/",
      findingIds: [],
      title: `${kind} ${index}`,
      why: "why",
      effort: "low" as const,
      expectedEffect: "effect",
      edit: null,
      taskId: null,
      status: "recommended" as const,
      kind,
      evidence: [],
    });
    workspace.actions = [
      ...Array.from({ length: 25 }, (_, index) => action("fix", index)),
      ...Array.from({ length: 3 }, (_, index) => action("opportunity", index)),
    ];
    const kinds = JSON.parse(seoChatContext(workspace)).actions.map(
      (row: { kind: string }) => row.kind,
    );
    expect(kinds).toHaveLength(20);
    // Kinds alternate, so trimming for size drops both kinds evenly.
    expect(kinds.slice(0, 4)).toEqual([
      "fix",
      "opportunity",
      "fix",
      "opportunity",
    ]);
    expect(kinds.filter((kind: string) => kind === "opportunity")).toHaveLength(
      3,
    );
  });

  it("rejects unknown actions and removes only analysis suggestions while dispatch is paused", () => {
    expect(() =>
      parseSeoChatReply(
        JSON.stringify({
          reply: "Use this",
          actions: [{ kind: "execute", command: "connect all accounts" }],
        }),
        true,
      ),
    ).toThrow();
    expect(
      parseSeoChatReply(
        JSON.stringify({
          reply: "Review the pages",
          actions: [
            { kind: "open", dialog: "analysis" },
            { kind: "open", dialog: "keyword" },
            { kind: "connect", provider: "ga4" },
          ],
        }),
        false,
      ).actions,
    ).toEqual([
      { kind: "open", dialog: "keyword" },
      { kind: "connect", provider: "ga4" },
    ]);
  });
});
