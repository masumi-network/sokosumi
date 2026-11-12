import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  SEO_QUERY_RETRY_MS,
  SEO_SEARCH_STALE_MS,
  seoAgentBrief,
} from "./seo-agent-model";
import { seoTestStrategy, seoTestWorkspace } from "./seo-test-fixture";

const synced = new Date("2026-11-07T12:00:00Z");
function searchMetric(
  key: string,
  value: number,
): ProjectSeoWorkspace["metrics"][number] {
  return {
    id: `metric:${key}`,
    key,
    label: key,
    unit: "count",
    source: "search_console",
    propertyId: "sc-domain:example.com",
    value,
    from: "2026-10-09",
    to: "2026-11-05",
    timeZone: "America/Los_Angeles",
    channel: "organic",
    observedAt: synced,
    coverage: "partial",
    points: [],
    notes: [],
  };
}
function opportunity(id: string): ProjectSeoWorkspace["actions"][number] {
  return {
    id,
    kind: "opportunity",
    evidence: ["Query: battery"],
    observationId: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
    pageUrl: "https://example.com/",
    findingIds: [],
    title: id,
    why: "heuristic",
    effort: "low",
    expectedEffect: "hypothesis",
    edit: null,
    taskId: null,
    status: "recommended",
  };
}
function connected() {
  const workspace = seoTestWorkspace();
  workspace.availableActions.canSyncMetrics = true;
  workspace.metrics = [
    searchMetric("clicks", 2),
    searchMetric("impressions", 28),
  ];
  return workspace;
}

describe("SEO agent brief", () => {
  it("offers the audit's strategy actions as one step after the fixes and before upkeep", () => {
    const workspace = connected();
    workspace.actions = [opportunity("first")];
    expect(
      seoAgentBrief(workspace, synced).steps.some(
        (step) => step.kind === "strategy",
      ),
    ).toBe(false);
    workspace.strategy = seoTestStrategy();
    const steps = seoAgentBrief(workspace, synced).steps;
    expect(steps.map((step) => step.kind).slice(0, 3)).toEqual([
      "action",
      "strategy",
      "refresh",
    ]);
    expect(steps[1]).toEqual({ kind: "strategy", count: 2 });
  });

  it("loads missing query rows after a retry delay, not right after a sync", () => {
    const brief = seoAgentBrief(connected(), synced);
    expect(brief.steps).toContainEqual({
      kind: "refresh",
      reason: "no_queries",
    });
    // A sync that just ran without query rows is not retried at once.
    expect(brief.autoRefresh).toBe(false);
    expect(
      seoAgentBrief(
        connected(),
        new Date(synced.getTime() + SEO_QUERY_RETRY_MS + 1),
      ).autoRefresh,
    ).toBe(true);
  });

  it("refreshes stale Search Console data automatically, but only when it may sync", () => {
    const later = new Date(synced.getTime() + SEO_SEARCH_STALE_MS + 1);
    expect(seoAgentBrief(connected(), later).autoRefresh).toBe(true);
    const readOnly = connected();
    readOnly.availableActions.canSyncMetrics = false;
    expect(seoAgentBrief(readOnly, later).autoRefresh).toBe(false);
    const withQueries = connected();
    withQueries.searchQueries = {
      observationId: crypto.randomUUID(),
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-28",
      timeZone: "UTC",
      observedAt: synced,
      rowLimit: 250,
      truncated: false,
      rows: [],
    };
    expect(
      seoAgentBrief(
        withQueries,
        new Date(synced.getTime() + SEO_SEARCH_STALE_MS),
      ).autoRefresh,
    ).toBe(false);
  });

  it("puts confirmed fixes before review opportunities and caps the list", () => {
    const workspace = connected();
    workspace.actions = [
      opportunity("o1"),
      opportunity("o2"),
      { ...opportunity("f1"), kind: "fix", evidence: [] },
      opportunity("o3"),
    ];
    const brief = seoAgentBrief(workspace, synced);
    expect(
      brief.steps.flatMap((step) =>
        step.kind === "action" ? [step.action.id] : [],
      ),
    ).toEqual(["f1", "o1", "o2"]);
    expect(brief).toMatchObject({ fixes: 1, opportunities: 3 });
  });

  it("offers connection and research steps instead of empty numbers", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canSyncMetrics = true;
    workspace.availableActions.canUsePaidSearchData = false;
    const brief = seoAgentBrief(workspace, synced);
    expect(brief.steps).toEqual(
      expect.arrayContaining([
        { kind: "connect", provider: "search_console" },
        { kind: "competitors", available: false },
      ]),
    );
    // One Google step at a time: Search Console comes first.
    expect(brief.steps).not.toContainEqual({
      kind: "connect",
      provider: "ga4",
    });
  });

  it("drops the add-competitor step once a competitor is saved without paid data", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canUsePaidSearchData = false;
    workspace.competitors = [
      {
        id: "saved",
        url: "https://competitor.example/",
        role: "competitor",
        confirmed: true,
        source: "saved",
        rank: null,
        backlinks: null,
        referringDomains: null,
        observedAt: null,
        observationId: null,
        version: 1,
        canConfirm: true,
        exclusionReason: null,
      },
    ];
    const kinds = seoAgentBrief(workspace, synced).steps.map(
      (step) => step.kind,
    );
    expect(kinds).not.toContain("competitors");
    workspace.availableActions.canUsePaidSearchData = true;
    expect(
      seoAgentBrief(workspace, synced).steps.map((step) => step.kind),
    ).toContain("competitors");
  });

  it("offers no competitor step where a saved competitor can show nothing", () => {
    const workspace = seoTestWorkspace();
    Object.assign(workspace.availableActions, {
      canUsePaidSearchData: false,
      canRequestAnalysis: false,
    });
    const kinds = () =>
      seoAgentBrief(workspace, synced).steps.map((step) => step.kind);
    expect(kinds()).not.toContain("competitors");
    // A check can still use a saved competitor, so the step returns with checks.
    workspace.availableActions.canRequestAnalysis = true;
    expect(kinds()).toContain("competitors");
  });
});
