import type { ProjectSeoMetric } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoSetup } from "./seo-setup-model";
import { seoTestWorkspace } from "./seo-test-fixture";

const SEARCH_METRIC: ProjectSeoMetric = {
  id: "search-clicks",
  key: "clicks",
  label: "Clicks",
  unit: "count",
  source: "search_console",
  propertyId: "sc-domain:example.com",
  value: 100,
  from: "2026-09-01",
  to: "2026-09-28",
  timeZone: "UTC",
  channel: "organic",
  observedAt: new Date("2026-10-01T10:00:00Z"),
  coverage: "complete",
  points: [],
  notes: [],
};

const states = (workspace = seoTestWorkspace()) =>
  seoSetup(workspace)?.steps.map((step) => `${step.kind}:${step.state}`);

describe("SEO first-run setup", () => {
  it("gives the primary button to the first step that is not done", () => {
    expect(states()).toEqual(["page:done", "connect:next", "check:open"]);
    expect(seoSetup(seoTestWorkspace())).toMatchObject({ done: 1, total: 3 });
  });

  it("waits for a page before the other steps, without calling them unavailable", () => {
    const workspace = seoTestWorkspace();
    workspace.scope.pageIds = [];
    // Core reports no sync and no check right for an empty scope.
    workspace.availableActions.canRequestAnalysis = false;
    workspace.availableActions.canSyncMetrics = false;
    expect(states(workspace)).toEqual([
      "page:next",
      "connect:waiting",
      "check:waiting",
    ]);
    expect(seoSetup(workspace)).toMatchObject({ done: 0, total: 3 });
  });

  it("leaves a step this workspace cannot do out of the progress count", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canSyncMetrics = false;
    expect(states(workspace)).toEqual([
      "page:done",
      "connect:unavailable",
      "check:next",
    ]);
    expect(seoSetup(workspace)).toMatchObject({
      done: 1,
      total: 2,
      next: "check",
    });
  });

  it("ends when no step is left that the reader can do", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    workspace.availableActions.canSyncMetrics = false;
    expect(seoSetup(workspace)).toBeNull();
  });

  it("counts Search Console as connected once its statistics are saved", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [
      {
        ...SEARCH_METRIC,
        source: "ga4",
      },
    ];
    expect(states(workspace)?.[1]).toBe("connect:next");
    workspace.metrics = [SEARCH_METRIC];
    expect(states(workspace)).toEqual([
      "page:done",
      "connect:done",
      "check:next",
    ]);
  });

  it("speaks for the whole Audit, so a page, date or channel filter ends it", () => {
    const none = {
      from: null,
      to: null,
      pageId: null,
      scopeId: null,
      channel: null,
    };
    expect(seoSetup(seoTestWorkspace(), none)).not.toBeNull();
    for (const key of ["from", "to", "pageId", "scopeId", "channel"] as const)
      expect(seoSetup(seoTestWorkspace(), { ...none, [key]: "x" })).toBeNull();
  });

  it("shows a check in flight, and asks again after the newest check failed", () => {
    const workspace = seoTestWorkspace();
    const analysis = {
      id: "a1",
      kind: "page_check" as const,
      status: "running" as const,
      taskId: null,
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      createdAt: new Date("2026-01-02T12:00:00Z"),
    };
    const failedAt = (date: string) => ({
      ...analysis,
      id: "a2",
      status: "failed" as const,
      createdAt: new Date(date),
    });
    workspace.analyses = [analysis];
    expect(states(workspace)?.[2]).toBe("check:running");
    expect(seoSetup(workspace)?.failed).toBe(false);
    // A check that Core accepted and has not started is in flight too.
    workspace.analyses = [{ ...analysis, status: "requested" }];
    expect(states(workspace)?.[2]).toBe("check:running");
    // A newer failed check is no news while another check runs.
    workspace.analyses = [failedAt("2026-01-03T12:00:00Z"), analysis];
    expect(seoSetup(workspace)).toMatchObject({
      failed: false,
      next: "connect",
    });
    // The newest check decides, in whatever order Core lists them. The failed
    // check takes the primary button from the connect step before it.
    workspace.analyses = [
      failedAt("2026-01-03T12:00:00Z"),
      { ...analysis, status: "completed" },
    ];
    expect(states(workspace)).toEqual([
      "page:done",
      "connect:open",
      "check:next",
    ]);
    expect(seoSetup(workspace)?.failed).toBe(true);
    workspace.analyses = [
      failedAt("2026-01-01T12:00:00Z"),
      { ...analysis, status: "completed" },
    ];
    expect(seoSetup(workspace)).toMatchObject({
      failed: false,
      next: "connect",
    });
    // A failed check the reader cannot run again is not shown as a task.
    workspace.analyses = [failedAt("2026-01-03T12:00:00Z")];
    workspace.availableActions.canRequestAnalysis = false;
    expect(seoSetup(workspace)).toMatchObject({
      failed: false,
      next: "connect",
    });
  });

  it("ends once a check saved a result, and for a reader who cannot edit", () => {
    const readOnly = seoTestWorkspace();
    readOnly.availableActions.canEdit = false;
    expect(seoSetup(readOnly)).toBeNull();
    const checked = seoTestWorkspace();
    checked.observations = [{} as (typeof checked.observations)[number]];
    expect(seoSetup(checked)).toBeNull();
  });
});
