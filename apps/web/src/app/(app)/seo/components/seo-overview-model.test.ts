import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  measureValue,
  seoOverviewModel,
  seoPageSummaries,
} from "./seo-overview-model";
import { SEO_TEST_PAGE, seoTestWorkspace } from "./seo-test-fixture";

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
    kind: "fix",
    evidence: [],
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
    issues: 0,
    coverage: { checked, skipped, failed },
  };
}

describe("SEO overview relevance", () => {
  it("treats requested module failures as incomplete without counting unrequested modules as skipped rules", () => {
    const workspace = seoTestWorkspace();
    workspace.observations = [observation(12)];
    workspace.observations[0].coverage.modules = { notRequested: 2, failed: 0 };
    expect(seoOverviewModel(workspace).emptyState).toBe("no_fixes");
    workspace.observations[0].coverage.modules.failed = 1;
    expect(seoOverviewModel(workspace).emptyState).toBe("incomplete");
  });

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

  it("shows a measurement once per check when each device reported it", () => {
    const workspace = seoTestWorkspace();
    const measured = (id: string, observationId: string) => ({
      ...finding(id, "measure"),
      title: "Title length",
      evidence: ["title 56 characters"],
      observationId,
    });
    workspace.findings = [
      { ...measured("desktop", "check-1"), device: "desktop" as const },
      { ...measured("mobile", "check-1"), device: "mobile" as const },
      // Another check keeps its own row, with its own date and evidence link.
      measured("earlier", "check-0"),
    ];
    expect(seoOverviewModel(workspace).diagnostics).toHaveLength(2);
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

describe("seoPageSummaries", () => {
  it("counts a viewed page's issues and takes its newest check that ran rules", () => {
    const other = {
      ...seoTestWorkspace().pages[0],
      id: "other",
      url: "https://example.com/b",
    };
    const older = {
      ...observation(5),
      pageIds: [SEO_TEST_PAGE, "other"],
      sourceTaskId: "older-task",
    };
    const newer = {
      ...observation(0, 3),
      observedAt: new Date("2026-01-05T12:00:00Z"),
      pageIds: [SEO_TEST_PAGE],
    };
    const outside = { ...other, id: "outside", url: "https://example.com/c" };
    const base = seoTestWorkspace();
    const workspace: ProjectSeoWorkspace = {
      ...base,
      pages: [...base.pages, other, outside],
      // The view covers two of the three pages; the API sends nothing for the third.
      scope: { ...base.scope, pageIds: [SEO_TEST_PAGE, "other"] },
      // Newest first; the newer one skipped every rule, so it is not a check of the page.
      observations: [newer, older],
      findings: [
        finding("broken", "critical"),
        finding("note", "note"),
        { ...finding("elsewhere", "minor"), pageUrl: other.url },
      ],
    };
    const summaries = seoPageSummaries(workspace);
    // The last check's results open from the page row.
    expect(summaries.get(SEO_TEST_PAGE)).toEqual({
      issues: 1,
      checkedAt: older.observedAt,
      checkId: older.id,
      incomplete: false,
    });
    expect(summaries.get("other")).toEqual({
      issues: 1,
      checkedAt: older.observedAt,
      checkId: older.id,
      incomplete: false,
    });
    // No summary rather than a false "no issues" for a page outside the view.
    expect(summaries.has("outside")).toBe(false);
  });

  it("marks a check with unavailable rules and says nothing when a cut history shows no check", () => {
    const base = seoTestWorkspace();
    const partial = { ...observation(4, 0, 2), pageIds: [SEO_TEST_PAGE] };
    expect(
      seoPageSummaries({ ...base, observations: [partial] }).get(SEO_TEST_PAGE)
        ?.incomplete,
    ).toBe(true);
    // A newer check where every rule was unavailable is the last check, not the older full one.
    const complete = { ...observation(5), pageIds: [SEO_TEST_PAGE] };
    const failed = {
      ...observation(0, 0, 3),
      observedAt: new Date("2026-01-05T12:00:00Z"),
      pageIds: [SEO_TEST_PAGE],
    };
    expect(
      seoPageSummaries({ ...base, observations: [failed, complete] }).get(
        SEO_TEST_PAGE,
      ),
    ).toEqual({
      issues: 0,
      checkedAt: failed.observedAt,
      // A check without a Task has no results to open.
      checkId: null,
      incomplete: true,
    });
    const cut = {
      ...base,
      observations: [],
      history: { ...base.history, limited: true },
    };
    expect(seoPageSummaries(cut).has(SEO_TEST_PAGE)).toBe(false);
    expect(
      seoPageSummaries({ ...cut, history: base.history }).get(SEO_TEST_PAGE),
    ).toEqual({ issues: 0, checkedAt: null, checkId: null, incomplete: false });
  });
});

describe("measureValue", () => {
  it("drops the words the measurement's name already says", () => {
    expect(measureValue("Title length", "title 56 characters")).toBe(
      "56 characters",
    );
    expect(
      measureValue(
        "Meta description length",
        "meta description 163 characters",
      ),
    ).toBe("163 characters");
  });

  it("keeps text that does not start with the name, and never empties it", () => {
    expect(measureValue("Title length", "56 characters")).toBe("56 characters");
    expect(measureValue("Title", "title")).toBe("title");
    expect(measureValue("H1 count", "h1: 2")).toBe("h1: 2");
  });
});
