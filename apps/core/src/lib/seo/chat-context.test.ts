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
      analysisDispatchEnabled: false,
      limited: true,
      totals: { observations: 100 },
      metrics: [{ key: "page_views", value: 321 }],
    });
    expect(evidence.observations.length).toBeLessThan(100);
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
