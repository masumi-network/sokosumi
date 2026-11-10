import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  SEO_QUERY_RETRY_MS,
  SEO_SEARCH_STALE_MS,
  seoAgentBrief,
} from "./seo-agent-model";
import { seoTestWorkspace } from "./seo-test-fixture";

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
    // One Google step: the Search Console step also offers Google Analytics.
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

  it("proposes a tracked keyword Google did not list before account upkeep", () => {
    const workspace = connected();
    workspace.keywords = [
      { keyword: "USDC", saved: true },
      { keyword: "MacBook  Battery", saved: true },
      { keyword: "ignored", saved: false },
    ] as unknown as ProjectSeoWorkspace["keywords"];
    workspace.searchQueries = {
      rows: [{ query: "usdc", clicks: 1, impressions: 9, averagePosition: 4 }],
    } as unknown as ProjectSeoWorkspace["searchQueries"];
    const steps = seoAgentBrief(workspace, synced).steps;
    expect(steps[0]).toEqual({ kind: "keyword", keyword: "MacBook  Battery" });
    expect(steps.findIndex((step) => step.kind === "keyword")).toBeLessThan(
      steps.findIndex((step) => step.kind === "connect"),
    );
    // A cut row list or no rows at all is no evidence either way.
    (workspace.searchQueries as { truncated: boolean }).truncated = true;
    expect(
      seoAgentBrief(workspace, synced).steps.map((step) => step.kind),
    ).not.toContain("keyword");
    workspace.searchQueries = null;
    expect(
      seoAgentBrief(workspace, synced).steps.map((step) => step.kind),
    ).not.toContain("keyword");
  });

  it("turns a measured value outside a tool range into a suggestion after the keyword step", () => {
    const workspace = connected();
    const measured = (id: string, evidence: string) => ({
      id,
      observationId: "check",
      pageUrl: "https://example.com/",
      device: "desktop" as const,
      rowId: id,
      title: `Raw HTML: ${id === "title" ? "Title" : "Meta description"} length`,
      severity: "measure",
      evidence: [
        evidence,
        "vendor tools: Ahrefs under 160 (N1-247); Moz 55 to 300 (N1-279)",
      ],
      sourceRef: "html",
      observedAt: synced,
    });
    workspace.findings = [
      measured("title", "title 56 characters"),
      // The same check's desktop row is in range; its mobile row is not, and that is the step.
      {
        ...measured("description", "meta description 150 characters"),
        id: "description-desktop",
      },
      {
        ...measured("description", "meta description 163 characters"),
        device: "mobile" as const,
      },
      // An older check of the same rule and page: the newest value is the step.
      {
        ...measured("description", "meta description 170 characters"),
        id: "description-old",
        observationId: "older-check",
      },
    ] as ProjectSeoWorkspace["findings"];
    workspace.keywords = [
      { keyword: "battery", saved: true },
    ] as unknown as ProjectSeoWorkspace["keywords"];
    workspace.searchQueries = {
      rows: [],
    } as unknown as ProjectSeoWorkspace["searchQueries"];
    workspace.observations = [
      {
        id: "check",
        kind: "page_check",
        source: "seo_coworker",
        observedAt: synced,
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop", "mobile"],
        rulebookVersion: "html-v1",
        artifactHash: "checked-html",
        issues: 0,
        coverage: { checked: 24, skipped: 0, failed: 0 },
      },
    ] as ProjectSeoWorkspace["observations"];
    const brief = seoAgentBrief(workspace, synced);
    const steps = brief.steps;
    // Only the value outside a range becomes a step; the last check counts it once.
    expect(brief.suggestions).toBe(1);
    // A newer check that did not measure it: the step stays, the last-check line does not count it.
    workspace.observations = [
      { ...workspace.observations[0], id: "newer-check" },
      ...workspace.observations,
    ];
    expect(seoAgentBrief(workspace, synced).suggestions).toBe(0);
    expect(
      seoAgentBrief(workspace, synced).steps.filter(
        (step) => step.kind === "measure",
      ),
    ).toHaveLength(1);
    workspace.observations = workspace.observations.slice(1);
    expect(steps.filter((step) => step.kind === "measure")).toEqual([
      {
        kind: "measure",
        name: "Meta description length",
        value: "163 characters",
        tools: ["Ahrefs"],
        pageUrl: "https://example.com/",
      },
    ]);
    // A suggestion is not an error: the keyword plan comes first.
    expect(steps.map((step) => step.kind).slice(0, 2)).toEqual([
      "keyword",
      "measure",
    ]);
    // A value fixed since: the newest check is in range, so an older value outside it is no step.
    workspace.findings = [
      measured("description", "meta description 150 characters"),
      {
        ...measured("description", "meta description 170 characters"),
        id: "description-old",
        observationId: "older-check",
      },
    ] as ProjectSeoWorkspace["findings"];
    const fixed = seoAgentBrief(workspace, synced);
    expect(fixed.steps.map((step) => step.kind)).not.toContain("measure");
    expect(fixed.suggestions).toBe(0);
  });
});
