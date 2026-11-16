import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";
import {
  parseSeoChatReply,
  SEO_CHAT_SYSTEM,
  seoChatContext,
} from "./chat-context";

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
    history: { limit: 100, limited: false, evidenceLimited: false },
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
  it("names the requested aggregate period instead of shortening it to traffic dates", () => {
    const workspace = workspaceFixture();
    workspace.metrics[0].points = [{ date: "2026-11-01", value: 321 }];
    const [metric] = JSON.parse(seoChatContext(workspace)).metrics;
    expect(metric).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-02",
      firstDataDay: "2026-11-01",
      lastDataDay: "2026-11-01",
    });
    expect(SEO_CHAT_SYSTEM).toContain(
      "Name the requested calendar period of a statistics total with its from and to.",
    );
  });

  it("names the whole data span of a sync even though only the newest daily points are sent", () => {
    const workspace = workspaceFixture();
    const days = Array.from({ length: 28 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
      // Google reports late: the newest two days have no data yet.
      value: index >= 26 ? null : index,
    }));
    workspace.metrics[0].points = days;
    const [metric] = JSON.parse(seoChatContext(workspace)).metrics;
    expect(metric.points.length).toBeLessThan(days.length);
    expect(metric).toMatchObject({
      firstDataDay: "2026-10-01",
      lastDataDay: "2026-10-26",
    });
  });

  it("names the search type of each Search Console metric and none for Analytics", () => {
    const workspace = workspaceFixture();
    const analytics = workspace.metrics[0];
    workspace.metrics = [
      {
        ...analytics,
        id: "discover",
        source: "search_console",
        searchType: "discover",
      },
      { ...analytics, id: "web", source: "search_console" },
      analytics,
    ];
    const metrics = JSON.parse(seoChatContext(workspace)).metrics;
    expect(
      metrics.map((row: { searchType?: string }) => row.searchType),
    ).toEqual(["discover", "web", undefined]);
  });

  it("names the search type of the query rows, web when none is stored", () => {
    const workspace = workspaceFixture();
    const queries = {
      observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
      propertyId: "sc-domain:example.com",
      from: "2026-11-01",
      to: "2026-11-02",
      timeZone: "UTC",
      observedAt: "2026-11-03T00:00:00.000Z",
      rowLimit: 250,
      truncated: false,
      rows: [],
    };
    workspace.searchQueries = { ...queries, searchType: "image" };
    expect(JSON.parse(seoChatContext(workspace)).searchQueries).toMatchObject({
      searchType: "image",
    });
    workspace.searchQueries = queries;
    expect(JSON.parse(seoChatContext(workspace)).searchQueries).toMatchObject({
      searchType: "web",
    });
  });

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
        issues: 0,
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
      difficulty: null,
      clicks: null,
      intent: null,
      conversion: null,
      feature: null,
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
      issues: 0,
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

  it("gives the agent the notes on promotion places, at most five", () => {
    const workspace = workspaceFixture();
    workspace.strategy = {
      verdict: "keep",
      why: "w",
      groups: [],
      actions: [],
      placesNotes: Array.from({ length: 7 }, (_, n) => `note ${n}`),
      observationId: randomUUID(),
      observedAt: new Date().toISOString(),
      countryCode: "US",
      languageCode: "en",
    };
    const { strategy, limited } = JSON.parse(seoChatContext(workspace));
    expect(strategy.placesNotes).toEqual([
      "note 0",
      "note 1",
      "note 2",
      "note 3",
      "note 4",
    ]);
    // The agent must know that it has 5 of the 7 notes.
    expect(limited).toBe(true);
    // A long note is cut, and the agent must know that too.
    workspace.strategy.placesNotes = [
      `${"x".repeat(400)}(https://terms.test/)`,
    ];
    const cut = JSON.parse(seoChatContext(workspace));
    expect([cut.strategy.placesNotes[0].length, cut.limited]).toEqual([
      400,
      true,
    ]);
    workspace.strategy.placesNotes = ["short"];
    expect(JSON.parse(seoChatContext(workspace)).limited).toBe(false);
  });

  it("gives the agent the site audit's strategy actions with their limits", () => {
    const workspace = workspaceFixture();
    expect(JSON.parse(seoChatContext(workspace)).strategy).toBeNull();
    const action = {
      kind: "get listed",
      title: "Ask to be added to these lists of products",
      why: "2 lists of products are in the top 10.",
      expectedEffect: "People who compare products can find the product.",
      effort: "medium" as const,
      limit: "Ask on the product's merits only.",
      targets: [
        {
          url: "https://lists.test/best",
          title: "Best apps",
          type: "listicle",
          state: "not mentioned",
        },
      ],
    };
    workspace.strategy = {
      verdict: "keep",
      why: "x".repeat(2500),
      groups: [],
      actions: Array.from({ length: 7 }, () => action),
      observationId: randomUUID(),
      observedAt: new Date().toISOString(),
      countryCode: "US",
      languageCode: "en",
    };
    const { strategy, limited } = JSON.parse(seoChatContext(workspace));
    // The agent must know that it has 5 of the 7 actions.
    expect(limited).toBe(true);
    expect(strategy.verdict).toBe("keep");
    // A reason of 400 to 600 chars is usual, and its last sentence names the niche.
    expect(strategy.why).toHaveLength(2000);
    expect(strategy.actions).toHaveLength(5);
    expect(strategy.actions[0]).toEqual({
      kind: "get listed",
      title: action.title,
      why: action.why,
      limit: action.limit,
      targetUrls: ["https://lists.test/best"],
    });
    workspace.strategy.actions = workspace.strategy.actions.slice(0, 5);
    expect(JSON.parse(seoChatContext(workspace)).limited).toBe(false);
    // A cut address is another address: a long one stays out, a short one stays whole.
    action.targets = [
      { ...action.targets[0], url: `https://lists.test/${"x".repeat(400)}` },
      action.targets[0],
    ];
    const cut = JSON.parse(seoChatContext(workspace));
    expect(cut.strategy.actions[0].targetUrls).toEqual([
      "https://lists.test/best",
    ]);
    // The agent must know that a place is missing.
    expect(cut.limited).toBe(true);
    // Many addresses cannot push the context past its size: whole actions drop first.
    action.targets = Array.from({ length: 20 }, (_, index) => ({
      ...action.targets[0],
      url: `https://lists.test/${index}/${"x".repeat(370)}`,
    }));
    const long = seoChatContext(workspace);
    expect(long.length).toBeLessThanOrEqual(30_000);
    expect(JSON.parse(long).limited).toBe(true);
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
  it("keeps the reply when a task action uses id instead of actionId", () => {
    const observationId = "0b8c4f1e-6f5c-4f0a-9d1e-2a3b4c5d6e7f";
    const tasks = new Set([`${observationId}:fix-title`]);
    expect(
      parseSeoChatReply(
        JSON.stringify({
          reply: "Fix the title first.",
          actions: [
            { kind: "task", observationId, id: "fix-title" },
            { kind: "task", observationId, actionId: "fix-title" },
          ],
        }),
        true,
        tasks,
      ),
    ).toEqual({
      reply: "Fix the title first.",
      actions: [{ kind: "task", observationId, actionId: "fix-title" }],
    });
  });
});
