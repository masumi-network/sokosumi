import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  SEO_QUERY_RETRY_MS,
  SEO_SEARCH_STALE_MS,
  type SeoAgentStep,
  seoActionHeadline,
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
    // One row per place: the page action and the two pages of the listing action.
    expect(steps[1]).toEqual({ kind: "strategy", count: 3, places: false });
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

  it("puts confirmed fixes before review opportunities and lists every one", () => {
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
    ).toEqual(["f1", "o1", "o2", "o3"]);
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

it("puts a cited cross-page experiment ahead of routine cleanup in the agent brief", () => {
  const workspace = connected();
  const experiment = {
    ...opportunity("link-journey"),
    decision: {
      kind: "open_strategy_opportunity" as const,
      alternative: "Visitors may already use the menu.",
      nextCheck: "Compare clicks to the booking page.",
    },
  };
  const cleanup = { ...opportunity("cleanup"), kind: "fix" as const };
  workspace.actions = [cleanup, experiment];
  const steps = seoAgentBrief(workspace, synced).steps;
  expect(steps[0]).toEqual({ kind: "action", action: experiment });
});

it("uses a measured organic outcome to choose between comparable actions only for the verified host", () => {
  const workspace = connected();
  const a = opportunity("first"),
    b = { ...opportunity("second"), pageUrl: "https://example.com/book" };
  workspace.actions = [a, b];
  workspace.landingPages = {
    verifiedHost: "example.com",
    channel: "organic",
    observationId: b.observationId,
    observedAt: synced,
    propertyId: "properties/1",
    from: "2026-10-01",
    to: "2026-10-31",
    rows: [{ pageUrl: b.pageUrl, sessions: 10, keyEvents: 2 }],
    pageUrls: [b.pageUrl],
  };
  expect(seoAgentBrief(workspace, synced).steps[0]).toEqual({
    kind: "action",
    action: b,
  });
  workspace.landingPages.verifiedHost = "other.example";
  expect(seoAgentBrief(workspace, synced).steps[0]).toEqual({
    kind: "action",
    action: a,
  });
});

describe("seoActionHeadline", () => {
  type Action = ProjectSeoWorkspace["actions"][number];
  const action = (id: string, kind = "fix") => ({ id, kind }) as Action;
  const steps: SeoAgentStep[] = [
    { kind: "action", action: action("a") },
    { kind: "strategy", count: 2, places: false },
    { kind: "action", action: action("b") },
    { kind: "action", action: action("c") },
  ];

  it("counts the action rows of the list, not its other steps, split by impact worst first", () => {
    const severity = { a: "minor", b: "major", c: "major" } as const;
    expect(
      seoActionHeadline(steps, (row) => severity[row.id as "a" | "b" | "c"]),
    ).toEqual({
      count: 3,
      parts: [
        { severity: "major", count: 2 },
        { severity: "minor", count: 1 },
      ],
      suggestions: false,
    });
  });

  it("names no split when an action has no issue, so the split never adds up to less than the count", () => {
    expect(
      seoActionHeadline(steps, (row) => (row.id === "a" ? null : "major")),
    ).toEqual({ count: 3, parts: [], suggestions: false });
  });

  it("reads a list of ideas only as suggestions, and a list with one fix as things to fix", () => {
    const ideas: SeoAgentStep[] = ["a", "b"].map((id) => ({
      kind: "action",
      action: action(id, "opportunity"),
    }));
    expect(seoActionHeadline(ideas, () => null).suggestions).toBe(true);
    expect(
      seoActionHeadline([...ideas, ...steps], () => null).suggestions,
    ).toBe(false);
  });
});
