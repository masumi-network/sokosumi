import {
  SEO_CAPABILITIES,
  SEO_STATISTICS_ANALYTICS_NO_AGGREGATE_NOTE,
  SEO_STATISTICS_ANALYTICS_THRESHOLDING_NOTE,
  SEO_STATISTICS_ANALYTICS_TIME_ZONE_NOTE,
  SEO_STATISTICS_ANALYTICS_TRUNCATED_NOTE,
  SEO_STATISTICS_QUERY_FAILED_NOTE,
  SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE,
  SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import {
  seoAuditGaps,
  seoCapabilityGroups,
  seoUnlockSteps,
} from "./seo-improve-model";
import {
  seoTestMetric,
  seoTestObservation,
  seoTestWorkspace,
} from "./seo-test-fixture";

describe("seoCapabilityGroups", () => {
  it("lists every item not built, in the doc's groups and order", () => {
    const groups = seoCapabilityGroups("all");
    const ids = groups.flatMap((group) => group.items.map((item) => item.id));
    expect(ids).not.toContain(34);
    expect(ids).toHaveLength(
      SEO_CAPABILITIES.filter((item) => item.status !== "built").length,
    );
    expect(groups.map((group) => group.group)).toEqual([
      "technical",
      "content",
      "keywords",
      "links",
      "local",
      "measurement",
      "ai",
      "workflow",
    ]);
  });

  it("keeps one status under a filter and drops a group left empty", () => {
    const catalog = [
      { ...SEO_CAPABILITIES[0], status: "partial" as const },
      { ...SEO_CAPABILITIES[3], status: "missing" as const },
      { ...SEO_CAPABILITIES[21], status: "planned" as const },
    ];
    expect(seoCapabilityGroups("missing", catalog)).toEqual([
      { group: "technical", items: [catalog[1]] },
    ]);
    expect(
      seoCapabilityGroups("all", catalog).map((group) => group.group),
    ).toEqual(["technical", "keywords"]);
  });
});

describe("seoAuditGaps", () => {
  it("asks a new audit to connect both sources and to run a first check", () => {
    expect(seoAuditGaps(seoTestWorkspace())).toEqual([
      { message: "noSearchConsole", fix: "connect_search_console" },
      { message: "noAnalytics", fix: "connect_ga4" },
      { message: "noCheck", fix: "run_check" },
    ]);
  });

  it("does not claim that no check ran where dates or a cut history hide checks", () => {
    const dated = seoTestWorkspace();
    dated.scope = { ...dated.scope, from: "2026-01-01" };
    const cut = seoTestWorkspace();
    cut.history = { limit: 200, limited: true };
    for (const workspace of [dated, cut])
      expect(seoAuditGaps(workspace).map((gap) => gap.message)).not.toContain(
        "noCheck",
      );
  });

  it("offers no fix the reader cannot take", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions = {
      ...workspace.availableActions,
      canSyncMetrics: false,
      canRequestAnalysis: false,
    };
    expect(seoAuditGaps(workspace).map((gap) => gap.fix)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("skips the routine Search Console note and names the Analytics notes", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [
      {
        ...seoTestMetric(),
        notes: [SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE],
      },
      {
        ...seoTestMetric(),
        id: "ga4:sessions",
        key: "sessions",
        source: "ga4",
        propertyId: "properties/1",
        channel: "organic",
        notes: [
          SEO_STATISTICS_QUERY_FAILED_NOTE,
          SEO_STATISTICS_ANALYTICS_TIME_ZONE_NOTE,
          SEO_STATISTICS_ANALYTICS_NO_AGGREGATE_NOTE,
          SEO_STATISTICS_ANALYTICS_THRESHOLDING_NOTE,
          SEO_STATISTICS_ANALYTICS_TRUNCATED_NOTE,
        ],
      },
    ];
    expect(
      seoAuditGaps(workspace)
        .filter((gap) => gap.fix === "sync")
        .map((gap) => gap.message),
    ).toEqual([
      "queryFailed",
      "analyticsTimeZone",
      "analyticsNoAggregate",
      "analyticsThresholding",
      "analyticsTruncated",
    ]);
  });

  it("reads the notes of the latest sync, the cut rows and the newest check only", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [
      {
        ...seoTestMetric(),
        notes: [SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE, "A new note."],
      },
      // An older sync of the same source: its note is no longer news.
      {
        ...seoTestMetric(),
        id: "old:clicks",
        observedAt: new Date("2025-12-01T00:00:00Z"),
        notes: ["An old note."],
      },
    ];
    workspace.searchQueries = {
      observationId: "sync",
      propertyId: "sc-domain:example.com",
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "UTC",
      observedAt: new Date("2026-01-03T00:00:00Z"),
      rowLimit: 500,
      truncated: true,
      rows: [],
    };
    const check = seoTestObservation(workspace);
    workspace.observations = [
      // A sync has no tests and is not the newest check.
      {
        ...check,
        id: "sync",
        coverage: { checked: 0, skipped: 0, failed: 0 },
      },
      {
        ...check,
        coverage: {
          checked: 10,
          skipped: 2,
          failed: 1,
          modules: {
            notRequested: 1,
            failed: 1,
            notRequestedNames: ["links.refresh"],
            failedNames: ["keyword.refresh"],
          },
        },
      },
      {
        ...check,
        id: "older",
        coverage: { checked: 1, skipped: 9, failed: 9 },
      },
    ];
    workspace.availableActions.canUsePaidSearchData = false;
    workspace.history = { limit: 200, limited: true };
    expect(seoAuditGaps(workspace)).toEqual([
      { message: "noAnalytics", fix: "connect_ga4" },
      { message: "queryRows", fix: "sync" },
      { message: "note", note: "A new note.", fix: "sync" },
      { message: "queriesTruncated", count: 500, fix: null },
      { message: "notChecked", count: 2, fix: "run_check" },
      { message: "failed", count: 1, fix: "run_check" },
      {
        message: "modulesNotRequested",
        names: ["links.refresh"],
        fix: "run_check",
      },
      {
        message: "modulesFailed",
        names: ["keyword.refresh"],
        fix: "run_check",
      },
      { message: "paidOff", fix: null },
      { message: "historyLimited", count: 200, fix: null },
    ]);
  });
});

describe("seoUnlockSteps", () => {
  it("marks a connected source done and offers to connect the other", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    const steps = seoUnlockSteps(workspace);
    expect(steps.find((step) => step.unlock === "search_console")).toEqual(
      expect.objectContaining({ done: true, connect: null }),
    );
    expect(steps.find((step) => step.unlock === "ga4")).toEqual(
      expect.objectContaining({ done: false, connect: "connect_ga4" }),
    );
  });

  it("counts the open items of a step and leaves out a step with none", () => {
    const steps = seoUnlockSteps(seoTestWorkspace(), [
      { ...SEO_CAPABILITIES[0], unlocks: ["paid_data", "development"] },
      { ...SEO_CAPABILITIES[33], unlocks: ["paid_data"] },
    ]);
    expect(steps.map((step) => [step.unlock, step.items])).toEqual([
      ["paid_data", 1],
      ["development", 1],
    ]);
  });
});

describe("Improve messages", () => {
  it("say each item in English as the catalog does", () => {
    const items = messages.App.Seo.improve.items as Record<
      string,
      { title: string; missing: string }
    >;
    for (const item of SEO_CAPABILITIES)
      expect(items[String(item.id)], `item ${item.id}`).toEqual({
        title: item.title,
        missing: item.missing ?? "",
      });
  });
});
