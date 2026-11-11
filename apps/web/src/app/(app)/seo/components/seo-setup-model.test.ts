import { describe, expect, it } from "vitest";
import { seoRunAction, seoRunningCheck, seoSetup } from "./seo-setup-model";
import { seoTestWorkspace } from "./seo-test-fixture";

describe("SEO header run action", () => {
  it("opens on a full audit only where Core accepts one: paid data and pages on one host", () => {
    const workspace = seoTestWorkspace();
    expect(seoRunAction(workspace)).toMatchObject({
      kind: "audit_full",
      label: "runFullAudit",
      ready: true,
    });
    const other = "0c9c0f5e-2f0b-4d0e-9a57-3a4b1f6d2c11";
    workspace.pages.push({
      ...workspace.pages[0],
      id: other,
      url: "https://shop.example.com/",
    });
    // A page outside the selection does not count.
    expect(seoRunAction(workspace)?.kind).toBe("audit_full");
    workspace.scope.pageIds.push(other);
    expect(seoRunAction(workspace)).toMatchObject({
      kind: "page_check",
      label: "runPageCheck",
    });
    workspace.scope.pageIds = [];
    expect(seoRunAction(workspace)).toBeNull();
  });

  it("leads until a recommended action waits, and stays ready then", () => {
    const workspace = seoTestWorkspace();
    expect(seoRunAction(workspace)).toMatchObject({ ready: true, leads: true });
    const action = {
      id: "action-row",
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      pageUrl: "https://example.com/",
      findingIds: [],
      title: "Fix the page title",
      why: "The title is missing",
      effort: "low",
      expectedEffect: "A descriptive search result",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    } as const;
    workspace.actions.push({ ...action, evidence: [], findingIds: [] });
    expect(seoRunAction(workspace)).toMatchObject({
      ready: true,
      leads: false,
    });
    // An action with a Task is under way: the next check leads again.
    workspace.actions[0].status = "task_created";
    expect(seoRunAction(workspace)?.leads).toBe(true);
  });
});

describe("SEO first-run setup", () => {
  it("has two steps: the page, then the first check as the next thing to do", () => {
    const workspace = seoTestWorkspace();
    expect(seoSetup(workspace)).toEqual({
      page: "done",
      check: "next",
      next: "check",
      failed: false,
    });
    workspace.scope.pageIds = [];
    // Core reports no check right for an empty selection: the check waits, it is not gone.
    workspace.availableActions.canRequestAnalysis = false;
    expect(seoSetup(workspace)).toEqual({
      page: "next",
      check: "waiting",
      next: "page",
      failed: false,
    });
  });

  it("ends when the reader cannot run the check, unless one is under way", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    expect(seoSetup(workspace)).toBeNull();
    workspace.analyses = [
      {
        id: "a1",
        kind: "page_check",
        status: "running",
        taskId: null,
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        createdAt: new Date("2026-01-02T12:00:00Z"),
      },
    ];
    expect(seoSetup(workspace)).toMatchObject({ check: "running", next: null });
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
    expect(seoSetup(workspace)).toMatchObject({
      check: "running",
      next: null,
      failed: false,
    });
    // A check that Core accepted and has not started is in flight too.
    workspace.analyses = [{ ...analysis, status: "requested" }];
    expect(seoSetup(workspace)?.check).toBe("running");
    // The newest check in flight is the one the card dates.
    workspace.analyses = [
      analysis,
      { ...analysis, id: "a3", createdAt: new Date("2026-01-04T12:00:00Z") },
    ];
    expect(seoRunningCheck(workspace)?.id).toBe("a3");
    // A newer failed check is no news while another check runs.
    workspace.analyses = [failedAt("2026-01-03T12:00:00Z"), analysis];
    expect(seoSetup(workspace)).toMatchObject({
      check: "running",
      failed: false,
    });
    // The newest check decides, in whatever order Core lists them.
    workspace.analyses = [
      failedAt("2026-01-03T12:00:00Z"),
      { ...analysis, status: "completed" },
    ];
    expect(seoSetup(workspace)).toMatchObject({ check: "next", failed: true });
    workspace.analyses = [
      failedAt("2026-01-01T12:00:00Z"),
      { ...analysis, status: "completed" },
    ];
    expect(seoSetup(workspace)).toMatchObject({ check: "next", failed: false });
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
