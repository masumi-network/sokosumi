import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoOverviewModel } from "./seo-overview-model";
import { seoTestWorkspace } from "./seo-test-fixture";

function finding(
  id: string,
  severity: ProjectSeoWorkspace["findings"][number]["severity"],
): ProjectSeoWorkspace["findings"][number] {
  return {
    id,
    severity,
    observationId: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
    pageUrl: "https://example.com/",
    device: "desktop",
    rowId: id,
    title: id,
    evidence: [],
    sourceRef: "html",
    observedAt: new Date("2026-01-03T12:00:00Z"),
  };
}
function action(
  id: string,
  findingIds: string[],
): ProjectSeoWorkspace["actions"][number] {
  return {
    id,
    findingIds,
    observationId: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
    pageUrl: "https://example.com/",
    title: id,
    why: "A source-supported recommendation",
    effort: "low",
    expectedEffect: "Resolve the reported issue",
    edit: null,
    taskId: null,
    status: "recommended",
  };
}
function observation(
  checked: number,
  skipped = 0,
  failed = 0,
): ProjectSeoWorkspace["observations"][number] {
  return {
    id: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
    kind: "page_check",
    source: "seo_coworker",
    observedAt: new Date("2026-01-03T12:00:00Z"),
    pageIds: [],
    scopeVersion: 0,
    sourceTaskId: null,
    countryCode: "US",
    languageCode: "en",
    devices: ["desktop"],
    rulebookVersion: "html-v1",
    artifactHash: "html",
    coverage: { checked, skipped, failed },
  };
}

describe("SEO overview relevance", () => {
  it("prioritizes actual issue severities without treating measures, notes or tests as fixes", () => {
    const workspace = seoTestWorkspace();
    workspace.findings = [
      finding("measure", "measure"),
      finding("minor", "minor"),
      finding("note", "note"),
      finding("critical", "critical"),
      finding("test", "test"),
      finding("major", "major"),
    ];
    const result = seoOverviewModel(workspace);
    expect(result.issues.map((item) => item.id)).toEqual([
      "critical",
      "major",
      "minor",
    ]);
    expect(result.diagnostics.map((item) => item.id)).toEqual([
      "measure",
      "note",
      "test",
    ]);
    expect(workspace.findings[0].id).toBe("measure");
  });

  it("ranks cited issues while preserving strategic proposals, unknown references and linked work", () => {
    const workspace = seoTestWorkspace();
    workspace.findings = [
      finding("minor", "minor"),
      finding("critical", "critical"),
    ];
    workspace.actions = [
      action("strategic", []),
      action("minor", ["minor"]),
      action("unknown", ["not-in-scope"]),
      {
        ...action("linked", ["critical"]),
        status: "implemented",
        taskId: "existing-task",
      },
      action("critical", ["critical"]),
    ];
    const result = seoOverviewModel(workspace);
    expect(result.actions.map((item) => item.id)).toEqual([
      "linked",
      "critical",
      "minor",
      "strategic",
      "unknown",
    ]);
    expect(result.recommendedActions.map((item) => item.id)).toEqual([
      "critical",
      "minor",
      "strategic",
      "unknown",
    ]);
    expect(workspace.actions[0].id).toBe("strategic");
  });

  it("distinguishes no checked evidence, limited successful checks and actual failures", () => {
    const workspace = seoTestWorkspace();
    expect(seoOverviewModel(workspace).emptyState).toBe("no_checks");
    workspace.observations = [observation(2, 2)];
    expect(seoOverviewModel(workspace)).toMatchObject({
      emptyState: "no_fixes",
      hasFailedChecks: false,
    });
    workspace.observations = [observation(0, 2, 1)];
    expect(seoOverviewModel(workspace)).toMatchObject({
      emptyState: "incomplete",
      hasFailedChecks: true,
    });
    workspace.observations = [observation(1, 0, 1)];
    expect(seoOverviewModel(workspace)).toMatchObject({
      emptyState: "incomplete",
      hasFailedChecks: true,
    });
    workspace.findings = [finding("major", "major")];
    expect(seoOverviewModel(workspace).emptyState).toBe("issues");
  });
});
