import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  measuresOutsideToolRanges,
  measureValue,
  noteFinding,
  pageDetailGuidance,
  pageDetailGuidanceRows,
  pageDetailReferences,
  pageDetailRuleCodes,
  seoOverviewModel,
  seoPageSummaries,
  toolRangeFit,
  withoutRuleCodes,
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

  it("names what an action fixes by its worst issue and that issue's first line, or by nothing", () => {
    const workspace = seoTestWorkspace();
    workspace.findings = [
      { ...finding("minor", "minor"), evidence: ["4 of 20 images"] },
      {
        ...finding("critical", "critical"),
        title: "Raw HTML: Indexable",
        evidence: ["the raw HTML has a noindex", "second line"],
      },
      // A line of no characters says nothing: the card then keeps the effect of the fix.
      { ...finding("silent", "major"), evidence: ["", " "] },
    ];
    const { actionProblem } = seoOverviewModel(workspace);
    expect(actionProblem(action("both", ["minor", "critical"]))).toEqual({
      check: "Indexable",
      found: "the raw HTML has a noindex",
    });
    expect(actionProblem(action("silent", ["silent"]))).toBeNull();
    expect(actionProblem(action("search-only", []))).toBeNull();
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

  it("lists a rule that fails on both devices once per page, with its devices and all evidence", () => {
    const workspace = seoTestWorkspace();
    const failed = (
      id: string,
      device: "mobile" | "desktop",
      patch: Partial<ProjectSeoWorkspace["findings"][number]> = {},
    ) => ({
      ...finding(id, "major"),
      rowId: "SD-06",
      device,
      evidence: [`${device} evidence`, "shared evidence"],
      ...patch,
    });
    workspace.findings = [
      // The devices can rate one rule differently: still one issue, with the higher rating.
      failed("a-desktop", "desktop", { severity: "minor" }),
      failed("a-mobile", "mobile"),
      // The same rule on another page is another issue.
      failed("b-mobile", "mobile", { pageUrl: "https://example.com/guide" }),
      // Another rule on the first page too.
      failed("c-desktop", "desktop", { rowId: "P-06" }),
    ];
    workspace.actions = [action("fix", ["a-desktop"])];
    const result = seoOverviewModel(workspace);
    expect(
      result.issues.map((item) => [item.id, item.devices, item.evidence]),
    ).toEqual([
      [
        "a-mobile",
        ["mobile", "desktop"],
        ["mobile evidence", "shared evidence", "desktop evidence"],
      ],
      ["b-mobile", ["mobile"], ["mobile evidence", "shared evidence"]],
      ["c-desktop", ["desktop"], ["desktop evidence", "shared evidence"]],
    ]);
    // An action that cites the merged device row still ranks as a fix for an issue.
    expect(result.recommendedActions.map((item) => item.id)).toEqual(["fix"]);
    // The issue finds its fix through either device row; an issue without an action has none.
    expect(
      result.issues.map((item) => result.issueFix(item)?.action.id),
    ).toEqual(["fix", undefined, undefined]);
    expect(result.issueFix(result.issues[0])?.named).toBe(true);
    // The action cites the row rated minor, and shows the rating of its issue.
    expect(result.actionSeverity(workspace.actions[0])).toBe("major");
    expect(result.actionSeverity(action("search", []))).toBeNull();
    // One action for two issues: its title names neither of them.
    workspace.actions = [action("both", ["a-mobile", "c-desktop"])];
    const shared = seoOverviewModel(workspace);
    expect(shared.issues.map((item) => shared.issueFix(item)?.named)).toEqual([
      false,
      undefined,
      false,
    ]);
    workspace.pages[0].url = "https://example.com/";
    workspace.scope.pageIds = [workspace.pages[0].id];
    workspace.observations = [
      { ...observation(3), pageIds: [workspace.pages[0].id] },
    ];
    expect(seoPageSummaries(workspace).get(workspace.pages[0].id)?.issues).toBe(
      2,
    );
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

describe("page detail lines", () => {
  const source = "Source: raw HTML; the rendered DOM was not requested.";
  const title = {
    name: "Title length",
    evidence: [
      "title 56 characters",
      "Google sets no length limit (N1-061)",
      source,
    ],
  };
  const note = {
    name: "No meta keywords",
    evidence: [
      'meta keywords in head: "battery"',
      source,
      "See the meta keywords reference",
    ],
  };
  const robots = {
    name: "Robots meta",
    evidence: ["index, follow", "Source: rendered DOM."],
  };

  it("shows every later line but provenance under the value", () => {
    expect(pageDetailGuidance(title.evidence)).toEqual([
      "Google sets no length limit (N1-061)",
    ]);
    // A note's own later lines stay with the note, not in the fold.
    expect(pageDetailGuidance(note.evidence)).toEqual([
      "See the meta keywords reference",
    ]);
  });

  it("folds each provenance line once and names rows only when not all rows share it", () => {
    expect(pageDetailReferences([title, note, robots])).toEqual([
      { line: source, names: ["Title length", "No meta keywords"] },
      { line: "Source: rendered DOM.", names: ["Robots meta"] },
    ]);
    expect(pageDetailReferences([title, note])).toEqual([
      { line: source, names: [] },
    ]);
    // The same rule on two pages is two rows: a line on both rows is shared by all.
    expect(pageDetailReferences([title, title, note])).toEqual([
      { line: source, names: [] },
    ]);
    expect(pageDetailReferences([title, title, robots])[0]).toEqual({
      line: source,
      names: ["Title length"],
    });
    // A single row keeps its name: without it the line has no owner.
    expect(pageDetailReferences([note])[0].names).toEqual(["No meta keywords"]);
  });

  it("shows guidance on the first row with it, once per set of lines", () => {
    const older = {
      id: "older",
      name: "Title length",
      evidence: ["title 40 characters", source],
    };
    const rows = [
      older,
      { id: "a", ...title },
      { id: "b", ...title },
      {
        id: "c",
        name: "Title length",
        evidence: ["title 80 characters", "vendor tools: Moz under 60", source],
      },
    ];
    // A row without lines does not take the slot; other lines still show.
    expect([...pageDetailGuidanceRows(rows)]).toEqual(["a", "c"]);
  });
});

describe("tool ranges", () => {
  const description = [
    "Google sets no length limit (N1-065)",
    "vendor tools: Ahrefs under 160 (N1-247); Screaming Frog 70 to 155 (N1-267); Moz 55 to 300 (N1-279); Yoast 120 to 156 (N1-286)",
  ];

  it("names the tools whose range a value leaves, with inclusive ends", () => {
    expect(toolRangeFit("163 characters", description)).toEqual({
      total: 4,
      outside: ["Ahrefs", "Screaming Frog", "Yoast"],
    });
    // 155 is Screaming Frog's top: inside. 160 is not under 160: outside.
    expect(toolRangeFit("155 characters", description)?.outside).toEqual([]);
    expect(toolRangeFit("160 characters", description)?.outside).toEqual([
      "Ahrefs",
      "Screaming Frog",
      "Yoast",
    ]);
    expect(
      toolRangeFit("9 characters", [
        "vendor tools: Ahrefs under 70; Screaming Frog 30 to 60; Moz 10 or more",
      ])?.outside,
    ).toEqual(["Screaming Frog", "Moz"]);
  });

  it("says nothing when a range or the value does not read", () => {
    expect(
      toolRangeFit("163 characters", ["vendor tools: Ahrefs about 160"]),
    ).toBeNull();
    expect(toolRangeFit("none", description)).toBeNull();
    expect(toolRangeFit("163 characters", ["Google sets no limit"])).toBeNull();
  });

  it("folds rule IDs out of the shown line, once each", () => {
    expect(withoutRuleCodes(description[1])).toBe(
      "vendor tools: Ahrefs under 160; Screaming Frog 70 to 155; Moz 55 to 300; Yoast 120 to 156",
    );
    expect(pageDetailRuleCodes([...description, description[0]])).toEqual([
      "N1-065",
      "N1-247",
      "N1-267",
      "N1-279",
      "N1-286",
    ]);
  });
});

describe("note finding", () => {
  it("splits at the label, not at a colon inside a quote", () => {
    expect(noteFinding('meta keywords in head: "battery, health"')).toEqual({
      found: "meta keywords in head",
      detail: '"battery, health"',
    });
    // Agent evidence names a link by its quoted text, which can hold ": ".
    expect(
      noteFinding(
        'a "Shop: new arrivals" (url) at 900 px: below the first screen',
      ),
    ).toEqual({
      found: 'a "Shop: new arrivals" (url) at 900 px',
      detail: "below the first screen",
    });
    expect(noteFinding("a “Shop: new” link at 900 px: below the fold")).toEqual(
      {
        found: "a “Shop: new” link at 900 px",
        detail: "below the fold",
      },
    );
    expect(noteFinding("Link „Shop: neu“ bei 900 px: unter dem Rand")).toEqual({
      found: "Link „Shop: neu“ bei 900 px",
      detail: "unter dem Rand",
    });
    expect(noteFinding("robots.txt blocks GPTBot")).toEqual({
      found: "robots.txt blocks GPTBot",
      detail: undefined,
    });
  });
});

describe("measures outside tool ranges", () => {
  it("groups one check's device rows into one suggestion that names every row", () => {
    const row = (id: string, observationId: string, characters: number) =>
      ({
        id,
        observationId,
        pageUrl: "https://example.com/",
        device: "desktop",
        rowId: "description-length",
        title: "Raw HTML: Meta description length",
        severity: "measure",
        evidence: [
          `meta description ${characters} characters`,
          "vendor tools: Ahrefs under 160 (N1-247)",
        ],
        sourceRef: "html",
        observedAt: new Date("2026-01-03T12:00:00Z"),
      }) as ProjectSeoWorkspace["findings"][number];
    // Rows come newest first; both devices of the newest check are outside the range.
    expect(
      measuresOutsideToolRanges([
        row("desktop", "new", 163),
        { ...row("mobile", "new", 170), device: "mobile" },
        row("older", "old", 180),
      ]),
    ).toEqual([
      {
        name: "Meta description length",
        value: "163 characters",
        tools: ["Ahrefs"],
        pageUrl: "https://example.com/",
        observationId: "new",
        findingIds: ["desktop", "mobile"],
      },
    ]);
  });
});
