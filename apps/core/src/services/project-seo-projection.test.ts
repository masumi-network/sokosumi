import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  type PublicSeoPayload,
  parsePublicSeoArtifact,
} from "@/helpers/project-seo-report";
import {
  focusedReport,
  legacyReport,
  SEO_TEST_PAGE,
  siteStrategyReport,
} from "@/test-fixtures/project-seo";

import { projectSeoProjection } from "./project-seo-projection";

type Input = Parameters<typeof projectSeoProjection>[0];
const now = new Date("2026-11-01T12:00:00Z");
function fixture(): Input {
  const projectId = randomUUID(),
    pageId = randomUUID();
  const page = {
    id: pageId,
    projectId,
    auditId: null,
    url: SEO_TEST_PAGE,
    label: "",
    relationship: "primary",
    relatedToPageId: null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    project: {
      id: projectId,
      websiteUrl: SEO_TEST_PAGE,
      closingAt: null,
      closedAt: null,
    },
    scope: {
      id: null,
      name: "All pages",
      version: 0,
      pageIds: [pageId],
      pages: [page],
    },
    query: {},
    pages: [page],
    scopes: [],
    observations: [],
    keywords: [],
    competitors: [],
    analyses: [],
    actionTasks: [],
    tasks: [],
    privateMetricsAllowed: true,
  };
}
function observation(
  input: Input,
  payload: PublicSeoPayload,
  capturedAt: string,
): Input["observations"][number] {
  return {
    id: randomUUID(),
    projectId: input.project.id,
    auditId: null,
    kind: payload.kind,
    source: "seo_coworker",
    sourceKey: randomUUID(),
    sourceTaskId: null,
    sourceFileId: null,
    ownerId: null,
    visibility: "PRIVATE",
    pageIds: input.scope.pageIds,
    scopeVersion: 0,
    artifactHash: "hash",
    payload,
    observedAt: new Date(capturedAt),
    createdAt: new Date(capturedAt),
  };
}
function metricObservation(input: Input, at: string, value: number) {
  return {
    ...observation(input, parsePublicSeoArtifact(focusedReport()), at),
    ownerId: randomUUID(),
    kind: "metrics",
    source: "ga4",
    payload: {
      provider: "ga4",
      propertyId: "properties/123",
      pageUrls: [SEO_TEST_PAGE],
      channel: "all",
      from: "2026-10-01",
      to: "2026-10-31",
      timeZone: "Europe/Oslo",
      observedAt: at,
      coverage: "complete",
      notes: [],
      metrics: [
        {
          key: "active_users",
          label: "Active users",
          unit: "count",
          value,
          points: [],
        },
      ],
    },
  };
}
function searchObservation(input: Input, at: string) {
  return {
    ...metricObservation(input, at, 2),
    source: "search_console",
    payload: {
      provider: "search_console",
      propertyId: "sc-domain:example.test",
      pageUrls: [SEO_TEST_PAGE],
      channel: "organic",
      from: "2026-10-09",
      to: "2026-11-05",
      timeZone: "America/Los_Angeles",
      observedAt: at,
      coverage: "partial",
      notes: [],
      metrics: [],
      queries: {
        rowLimit: 250,
        truncated: false,
        rows: [
          {
            query: "battery health",
            pageUrl: SEO_TEST_PAGE,
            clicks: 0,
            impressions: 12,
            ctr: 0,
            averagePosition: 3.2,
          },
          {
            query: "rare query",
            pageUrl: SEO_TEST_PAGE,
            clicks: 0,
            impressions: 1,
            ctr: 0,
            averagePosition: 9,
          },
        ],
      },
    },
  };
}
function actionFixture() {
  const input = fixture(),
    source = parsePublicSeoArtifact(legacyReport());
  const original = observation(input, source, "2026-11-01T12:00:00Z"),
    taskId = randomUUID();
  const pass = observation(
    input,
    parsePublicSeoArtifact(focusedReport()),
    "2026-11-03T12:00:00Z",
  );
  input.observations = [pass, original];
  input.actionTasks = [
    {
      id: randomUUID(),
      projectId: input.project.id,
      auditId: null,
      observationId: original.id,
      actionId: "1",
      taskId,
      idempotencyKey: "action-test",
      createdAt: now,
    },
  ];
  input.tasks = [
    {
      id: taskId,
      status: "COMPLETED",
      completedAt: new Date("2026-11-02T12:00:00Z"),
    },
  ];
  return { input, pass, original };
}

describe("stored SEO workspace projections", () => {
  it("projects historical focused module counts without adding phantom rule checks", () => {
    const input = fixture();
    const payload = parsePublicSeoArtifact(focusedReport());
    payload.coverage = { checked: 1, skipped: 2, failed: 0 };
    const original = observation(input, payload, "2026-11-01T12:00:00Z");
    input.observations = [original];

    const result = projectSeoProjection(input);
    expect(result.observations[0].coverage).toEqual({
      checked: 1,
      skipped: 0,
      failed: 0,
      modules: { notRequested: 2, failed: 0 },
    });
    expect(result.timeline[0]).toMatchObject({
      status: "completed",
      detail:
        "Rule checks: 1 checked, 0 not checked, 0 unavailable. Analysis types: 2 not requested, 0 unavailable.",
    });
    expect(payload.coverage).toEqual({ checked: 1, skipped: 2, failed: 0 });

    payload.coverage.failed = 1;
    expect(projectSeoProjection(input).timeline[0].status).toBe("partial");

    const legacy = parsePublicSeoArtifact(legacyReport());
    input.observations = [observation(input, legacy, "2026-11-01T12:00:00Z")];
    expect(projectSeoProjection(input).observations[0].coverage).toEqual(
      legacy.coverage,
    );
  });

  it("counts each run's issues on the selected pages only", () => {
    const input = fixture();
    const payload = parsePublicSeoArtifact(legacyReport());
    const [issue] = payload.findings;
    payload.findings.push(
      { ...issue, id: "other-page", pageUrl: "https://other.example/" },
      { ...issue, id: "note", severity: "note" },
      // The same rule fails on the other device: still one issue on the page.
      {
        ...issue,
        id: "other-device",
        device: issue.device === "mobile" ? "desktop" : "mobile",
      },
    );
    const clean = parsePublicSeoArtifact(focusedReport());
    input.observations = [
      observation(input, payload, "2026-11-01T12:00:00Z"),
      observation(input, clean, "2026-11-02T12:00:00Z"),
    ];
    const issues = Object.fromEntries(
      projectSeoProjection(input).observations.map((row) => [
        row.observedAt,
        row.issues,
      ]),
    );
    expect(issues).toEqual({
      "2026-11-01T12:00:00.000Z": 1,
      "2026-11-02T12:00:00.000Z": 0,
    });
  });

  it("lists every run outside the period, with the time its request took", () => {
    const input = fixture();
    const taskId = randomUUID();
    const first = observation(
      input,
      parsePublicSeoArtifact(legacyReport()),
      "2026-11-01T12:00:00Z",
    );
    const second = {
      ...observation(
        input,
        parsePublicSeoArtifact(focusedReport()),
        "2026-11-02T12:00:00Z",
      ),
      sourceTaskId: taskId,
      createdAt: new Date("2026-11-02T12:40:00Z"),
    };
    input.observations = [first, second];
    input.analyses = [
      {
        id: randomUUID(),
        projectId: input.project.id,
        auditId: null,
        kind: "page_check",
        status: "completed",
        taskId,
        pageIds: input.scope.pageIds,
        scopeVersion: 0,
        request: {},
        requestedBy: randomUUID(),
        requestHash: "hash",
        idempotencyKey: "run",
        failureReason: null,
        createdAt: new Date("2026-11-02T12:10:00Z"),
        updatedAt: now,
      },
    ];
    input.query = { from: "2026-11-02" };
    const view = projectSeoProjection(input);
    // The period cuts the results. It does not cut the list the reader picks a run from.
    expect(view.observations.map((row) => row.id)).toEqual([second.id]);
    expect(view.runs).toEqual([
      {
        observationId: first.id,
        kind: first.kind,
        observedAt: "2026-11-01T12:00:00.000Z",
        issues: 1,
        seconds: null,
      },
      {
        observationId: second.id,
        kind: second.kind,
        observedAt: "2026-11-02T12:00:00.000Z",
        issues: 0,
        seconds: 1800,
      },
    ]);
  });

  it("gives a run no issue count where it read only some of the selected pages", () => {
    const input = fixture();
    const [page] = input.pages;
    const blog = {
      ...page,
      id: randomUUID(),
      url: new URL("/blog", SEO_TEST_PAGE).href,
    };
    input.pages.push(blog);
    input.scope.pages.push(blog);
    input.scope.pageIds = [page.id, blog.id];
    const both = observation(
      input,
      parsePublicSeoArtifact(legacyReport()),
      "2026-11-02T12:00:00Z",
    );
    const one = {
      ...observation(
        input,
        parsePublicSeoArtifact(legacyReport()),
        "2026-11-01T12:00:00Z",
      ),
      pageIds: [page.id],
    };
    input.observations = [both, one];
    expect(projectSeoProjection(input).runs?.map((run) => run.issues)).toEqual([
      1,
      null,
    ]);
  });

  it("shows the newest site audit's strategy with the keyword groups of the selected pages", () => {
    const input = fixture();
    expect(projectSeoProjection(input).strategy).toBeNull();
    const current = parsePublicSeoArtifact(siteStrategyReport());
    const older = parsePublicSeoArtifact({
        ...siteStrategyReport(),
        strategy: { ...siteStrategyReport().strategy, verdict: "low demand" },
      }),
      newest = observation(
        input,
        {
          ...current,
          strategy: current.strategy && {
            ...current.strategy,
            groups: [
              ...current.strategy.groups,
              // The page selection did not name this group's page.
              { ...current.strategy.groups[0], lead: "no page", pageUrl: null },
            ],
          },
        },
        "2026-11-03T12:00:00Z",
      );
    input.observations = [
      // A focused check after the audit holds no strategy and hides none.
      observation(
        input,
        parsePublicSeoArtifact(focusedReport()),
        "2026-11-04T12:00:00Z",
      ),
      newest,
      observation(input, older, "2026-11-01T12:00:00Z"),
    ];
    const strategy = projectSeoProjection(input).strategy;
    expect(strategy).toMatchObject({
      verdict: "keep",
      observationId: newest.id,
      observedAt: "2026-11-03T12:00:00.000Z",
      countryCode: "US",
      languageCode: "en",
    });
    // The second page is not in the page selection. A group without a known page stays.
    expect(strategy?.groups.map((group) => group.lead)).toEqual([
      "example",
      "site term",
      "no page",
    ]);
    expect(strategy?.actions).toHaveLength(1);
    expect(
      projectSeoProjection({ ...input, query: { from: "2026-11-04" } })
        .strategy,
    ).toBeNull();
  });

  it("omits unsaved manual keywords while keeping real observations and saved choices", () => {
    const { input, original } = actionFixture();
    const choice = {
      projectId: input.project.id,
      auditId: null,
      countryCode: "US",
      languageCode: "en",
      pageId: input.pages[0].id,
      priority: "high",
      version: 2,
      updatedAt: now,
    };
    input.keywords = [
      {
        ...choice,
        id: randomUUID(),
        keyword: "example",
        keywordKey: "example",
        saved: false,
      },
      {
        ...choice,
        id: randomUUID(),
        keyword: "removed manual keyword",
        keywordKey: "removed manual keyword",
        saved: false,
      },
      {
        ...choice,
        id: randomUUID(),
        keyword: "saved manual keyword",
        keywordKey: "saved manual keyword",
        saved: true,
      },
    ];
    const result = projectSeoProjection(input);
    expect(result.keywords.map((row) => row.keyword)).not.toContain(
      "removed manual keyword",
    );
    const observed = result.keywords.filter((row) => row.keyword === "example");
    expect(observed.length).toBeGreaterThan(0);
    for (const row of observed)
      expect(row).toMatchObject({
        saved: false,
        observationId: original.id,
        observedAt: original.observedAt.toISOString(),
        pageUrl: SEO_TEST_PAGE,
      });
    expect(
      result.keywords.find((row) => row.keyword === "saved manual keyword"),
    ).toMatchObject({
      saved: true,
      source: "saved",
      observationId: null,
      observedAt: null,
    });
  });

  it("tracks a keyword a check read from the start and leaves an idea to the reader", () => {
    const input = fixture();
    const report = legacyReport();
    // An idea the check found the page for has a position: it is a read keyword.
    // A read keyword the save schema refuses (over 200 characters): "Stop tracking" could not be stored.
    const tooLong = "k".repeat(201);
    report.keywordOpportunities.list.push(
      Object.assign({}, report.keywordOpportunities.list[0], {
        keyword: "ranked idea",
        position: 7,
      }),
      Object.assign({}, report.keywordOpportunities.list[0], {
        keyword: tooLong,
        position: 3,
      }),
    );
    input.observations = [
      observation(
        input,
        parsePublicSeoArtifact(report),
        "2026-11-01T12:00:00Z",
      ),
    ];
    const tracked = () =>
      Object.fromEntries(
        projectSeoProjection(input).keywords.map((row) => [
          row.keyword,
          [row.saved, row.version],
        ]),
      );
    // No choice is stored (version 0).
    expect(tracked()).toEqual({
      example: [true, 0],
      "ranked term": [true, 0],
      "ranked idea": [true, 0],
      [tooLong]: [false, 0],
      "gap term": [false, 0],
      opportunity: [false, 0],
    });
    // The choice of the reader wins over the start value.
    input.keywords = [
      {
        id: randomUUID(),
        projectId: input.project.id,
        auditId: null,
        countryCode: "US",
        languageCode: "en",
        pageId: null,
        priority: "medium",
        keyword: "gap term",
        keywordKey: "gap term",
        saved: true,
        version: 1,
        updatedAt: now,
      },
    ];
    expect(tracked()["gap term"]).toEqual([true, 1]);
    // A check without a Market tracks nothing: a choice is stored per Market.
    input.keywords = [];
    const noMarket = legacyReport();
    Object.assign(noMarket.header, { market: null });
    input.observations = [
      observation(
        input,
        parsePublicSeoArtifact(noMarket),
        "2026-11-01T12:00:00Z",
      ),
    ];
    expect(tracked()).toMatchObject({
      example: [false, 0],
      "ranked term": [false, 0],
    });
  });

  it("keeps the saved keyword target distinct from the page observed in search", () => {
    const { input } = actionFixture();
    const target = {
      ...input.pages[0],
      id: randomUUID(),
      url: "https://example.test/target",
    };
    input.pages.push(target);
    input.scope.pages.push(target);
    input.scope.pageIds.push(target.id);
    input.keywords = [
      {
        id: randomUUID(),
        projectId: input.project.id,
        auditId: null,
        keyword: "example",
        keywordKey: "example",
        countryCode: "US",
        languageCode: "en",
        pageId: target.id,
        priority: "high",
        saved: true,
        version: 2,
        updatedAt: now,
      },
    ];
    const observed = projectSeoProjection(input).keywords.filter(
      (row) => row.keyword === "example",
    );
    expect(observed.length).toBeGreaterThan(0);
    expect(
      observed.every(
        (row) =>
          row.pageUrl === SEO_TEST_PAGE && row.targetPageId === target.id,
      ),
    ).toBe(true);
    input.observations = [];
    expect(projectSeoProjection(input).keywords[0]).toMatchObject({
      pageUrl: target.url,
      targetPageId: target.id,
      version: 2,
    });
  });

  it("removes an unlinked recommendation only after a later compatible explicit pass", () => {
    const { input, pass, original } = actionFixture();
    input.actionTasks = [];
    input.tasks = [];
    expect(projectSeoProjection(input).actions).toHaveLength(0);
    expect(
      projectSeoProjection(input).timeline.some(
        (row) => row.observationId === original.id,
      ),
    ).toBe(true);
    for (const change of [
      { countryCode: "DE" },
      { languageCode: "de" },
      { rulebookVersion: "another-rulebook" },
      {
        checks: [
          {
            rowId: "title",
            pageUrl: SEO_TEST_PAGE,
            device: "mobile",
            result: "pass",
          },
        ],
      },
      {
        checks: [
          {
            rowId: "title",
            pageUrl: SEO_TEST_PAGE,
            device: "desktop",
            result: "fired",
          },
        ],
      },
    ]) {
      pass.payload = { ...parsePublicSeoArtifact(focusedReport()), ...change };
      expect(
        projectSeoProjection(input).actions,
        JSON.stringify(change),
      ).toHaveLength(1);
    }
    pass.payload = parsePublicSeoArtifact(focusedReport());
    pass.observedAt = original.observedAt;
    expect(projectSeoProjection(input).actions).toHaveLength(1);
  });

  it("replaces an unlinked recommendation when a later check proposes its own fix for the finding", () => {
    const { input, original } = actionFixture();
    const linked = input.actionTasks;
    input.actionTasks = [];
    const latest = observation(
      input,
      parsePublicSeoArtifact(legacyReport()),
      "2026-11-04T12:00:00Z",
    );
    input.observations = [latest, original];
    const once = projectSeoProjection(input).actions;
    // The same findings fire again and the later check proposes its fixes: each fix shows once.
    expect(once.length).toBeGreaterThan(0);
    expect(new Set(once.map((action) => action.observationId))).toEqual(
      new Set([latest.id]),
    );
    // An older action with a Task and the later proposal are one piece of work: one card, from the later check.
    // The Task ended before the later check, which still finds the issue: the fix is an open action again.
    input.actionTasks = linked;
    const [task] = input.tasks;
    const cards = () => {
      const all = projectSeoProjection(input).actions;
      expect(
        all.filter((action) => action.observationId === original.id),
      ).toHaveLength(0);
      expect(all).toHaveLength(once.length);
      return all.find((action) => action.id === linked[0].actionId);
    };
    expect(cards()).toMatchObject({ status: "recommended", taskId: null });
    // The Task ended after the later check: the card says the fix is done and waits for the next check.
    input.tasks = [{ ...task, completedAt: new Date("2026-11-05T12:00:00Z") }];
    expect(cards()).toMatchObject({
      status: "implemented",
      taskId: task.id,
      observationId: latest.id,
    });
    // The Task is still open: the later card carries it, so no second Task starts for the issue.
    input.tasks = [{ ...task, status: "RUNNING", completedAt: null }];
    expect(cards()).toMatchObject({
      status: "task_created",
      taskId: task.id,
      observationId: latest.id,
    });
    // The reader made a Task from the later card: the older card does not come back beside it.
    input.tasks = [task, { ...task, id: randomUUID(), status: "RUNNING" }];
    input.actionTasks = [
      ...linked,
      {
        ...linked[0],
        id: randomUUID(),
        observationId: latest.id,
        taskId: input.tasks[1].id,
      },
    ];
    expect(cards()).toMatchObject({
      status: "task_created",
      taskId: input.tasks[1].id,
      observationId: latest.id,
    });
    input.tasks = [task];
    // Two fixes of one check for the same finding, each with a live Task: each later fix takes the Task of the
    // fix with its title, and no fix shows twice.
    const pair = parsePublicSeoArtifact(legacyReport());
    const second = { ...pair.actions[0], id: "second-fix", title: "Other fix" };
    original.payload = { ...pair, actions: [...pair.actions, second] };
    latest.payload = { ...pair, actions: [second, ...pair.actions] };
    const other = { ...task, id: randomUUID(), status: "RUNNING" as const };
    input.tasks = [{ ...task, status: "RUNNING", completedAt: null }, other];
    input.actionTasks = [
      ...linked,
      { ...linked[0], id: randomUUID(), actionId: second.id, taskId: other.id },
    ];
    const paired = projectSeoProjection(input).actions;
    expect(
      paired.map(({ id, observationId, taskId }) => ({
        id,
        observationId,
        taskId,
      })),
    ).toEqual(
      expect.arrayContaining([
        { id: linked[0].actionId, observationId: latest.id, taskId: task.id },
        { id: second.id, observationId: latest.id, taskId: other.id },
      ]),
    );
    expect(paired).toHaveLength(once.length + 1);
    // The later check proposes only the second fix: it takes the Task of the fix with its title, and the first
    // fix keeps its own card and Task. Neither Task drops out of view.
    latest.payload = { ...pair, actions: [second] };
    const kept = projectSeoProjection(input).actions;
    expect(
      kept.map(({ id, observationId, taskId }) => ({
        id,
        observationId,
        taskId,
      })),
    ).toEqual(
      expect.arrayContaining([
        { id: second.id, observationId: latest.id, taskId: other.id },
        { id: linked[0].actionId, observationId: original.id, taskId: task.id },
      ]),
    );
    latest.payload = pair;
    original.payload = pair;
    // A check after the Task ended still finds the issue, and the reader cancelled the Task made from it: the
    // finished Task did not hold the fix, so the card before it is an open action, not "Implemented".
    const after = observation(
      input,
      parsePublicSeoArtifact(legacyReport()),
      "2026-11-06T12:00:00Z",
    );
    const cancelled = {
      ...task,
      id: randomUUID(),
      status: "CANCELED" as const,
    };
    input.observations = [after, latest, original];
    input.tasks = [
      { ...task, completedAt: new Date("2026-11-05T12:00:00Z") },
      cancelled,
    ];
    input.actionTasks = [
      ...linked,
      {
        ...linked[0],
        id: randomUUID(),
        observationId: after.id,
        taskId: cancelled.id,
      },
    ];
    expect(
      projectSeoProjection(input).actions.find(
        (action) =>
          action.observationId === latest.id &&
          action.id === linked[0].actionId,
      ),
    ).toMatchObject({ status: "recommended", taskId: null });
    input.observations = [latest, original];
    input.actionTasks = linked;
    input.tasks = [task];
    // A check of another Market finds other things: its proposals replace nothing.
    input.actionTasks = [];
    latest.payload = {
      ...parsePublicSeoArtifact(legacyReport()),
      countryCode: "DE",
    };
    expect(projectSeoProjection(input).actions).toHaveLength(once.length * 2);
    // Two actions of one check can fix one finding: neither replaces the other.
    const source = parsePublicSeoArtifact(legacyReport());
    latest.payload = {
      ...source,
      actions: [...source.actions, { ...source.actions[0], id: "second-fix" }],
    };
    input.observations = [latest];
    expect(projectSeoProjection(input).actions).toHaveLength(
      source.actions.length + 1,
    );
  });

  it("lets only a live fix of a later check replace a recommendation, and only for each of its findings", () => {
    const { input, original } = actionFixture();
    const [link] = input.actionTasks;
    const [task] = input.tasks;
    const source = parsePublicSeoArtifact(legacyReport());
    const latest = observation(input, source, "2026-11-04T12:00:00Z");
    input.observations = [latest, original];
    const from = (id: string) =>
      projectSeoProjection(input).actions.filter(
        (action) => action.observationId === id,
      );
    // The owner made a Task from the later proposal: the older one does not come back.
    input.actionTasks = [{ ...link, observationId: latest.id }];
    expect(from(original.id)).toHaveLength(0);
    expect(from(latest.id)).toMatchObject([{ taskId: link.taskId }]);
    // A Task that was cancelled, failed or is gone fixes nothing: the older proposal is the open one.
    for (const tasks of [
      [],
      [{ ...task, status: "CANCELED" as const }],
      [{ ...task, status: "FAILED" as const }],
    ]) {
      input.tasks = tasks;
      expect(from(original.id), JSON.stringify(tasks)).toMatchObject([
        { status: "recommended" },
      ]);
    }
    // An older action that also fixes a finding the later check has no fix for stays.
    input.actionTasks = [];
    input.tasks = [task];
    const [finding] = source.findings;
    original.payload = {
      ...source,
      findings: [finding, { ...finding, id: "on-mobile", device: "mobile" }],
      actions: source.actions.map((action) => ({
        ...action,
        findingIds: [...action.findingIds, "on-mobile"],
      })),
    };
    expect(from(original.id)).toHaveLength(source.actions.length);
  });

  it("keeps the recommendation when the newest matching check fires again after a pass", () => {
    const { input, pass, original } = actionFixture();
    input.actionTasks = [];
    input.tasks = [];
    const latest = observation(
      input,
      {
        ...parsePublicSeoArtifact(focusedReport()),
        checks: [
          {
            rowId: "title",
            pageUrl: SEO_TEST_PAGE,
            device: "desktop",
            result: "fired",
          },
        ],
      },
      "2026-11-04T12:00:00Z",
    );
    input.observations = [latest, pass, original];
    expect(projectSeoProjection(input).actions).toMatchObject([
      { observationId: original.id, status: "recommended" },
    ]);
  });

  it("does not advertise paid dispatch before the compatible worker rollout is enabled", () => {
    const input = fixture();
    const disabled = projectSeoProjection(input);
    expect(disabled.availableActions).toMatchObject({
      canEdit: true,
      canRequestAnalysis: false,
      canSyncMetrics: true,
    });
    expect(
      projectSeoProjection({ ...input, analysisDispatchEnabled: true })
        .availableActions.canRequestAnalysis,
    ).toBe(true);
  });
  it("shows a failed ingestion as failed even when its source Task completed", () => {
    const input = fixture();
    const taskId = randomUUID();
    input.analyses = [
      {
        id: randomUUID(),
        projectId: input.project.id,
        auditId: null,
        kind: "page_check",
        status: "failed",
        taskId,
        pageIds: input.scope.pageIds,
        scopeVersion: 0,
        request: {},
        requestedBy: randomUUID(),
        requestHash: "hash",
        idempotencyKey: "failed-ingestion",
        failureReason: "The report did not match",
        createdAt: now,
        updatedAt: now,
      },
    ];
    input.tasks = [{ id: taskId, status: "COMPLETED", completedAt: now }];
    expect(projectSeoProjection(input).analyses[0].status).toBe("failed");
  });
  it("shows a keyword's conversion estimate and feature, and null for a row without one", () => {
    const { input, original } = actionFixture();
    const raw = legacyReport();
    const estimated = parsePublicSeoArtifact({
      ...raw,
      keywordOpportunities: {
        list: [
          {
            keyword: "estimated idea",
            volume: 20,
            position: null,
            intent: null,
            conversion: "high",
            feature: "Low battery alerts",
          },
        ],
      },
    });
    input.observations = [
      observation(input, estimated, "2026-11-03T12:00:00Z"),
      original,
    ];
    const { keywords } = projectSeoProjection(input);
    expect(
      keywords.find((row) => row.keyword === "estimated idea"),
    ).toMatchObject({ conversion: "high", feature: "Low battery alerts" });
    // A row without an estimate says null, not "low".
    expect(keywords.find((row) => row.keyword === "gap term")).toMatchObject({
      conversion: null,
      feature: null,
    });
  });
  it("keeps keyword Markets and device rows distinct while preserving saved priorities", () => {
    const { input, original } = actionFixture();
    const german = parsePublicSeoArtifact(legacyReport());
    german.countryCode = "DE";
    input.observations = [
      observation(input, german, "2026-11-03T12:00:00Z"),
      original,
    ];
    const result = projectSeoProjection(input);
    const examples = result.keywords.filter((row) => row.keyword === "example");
    expect(new Set(examples.map((row) => row.countryCode))).toEqual(
      new Set(["DE", "US"]),
    );
    expect(new Set(examples.map((row) => row.id)).size).toBe(examples.length);
    expect(result.observations[0]).toMatchObject({
      countryCode: "DE",
      languageCode: "en",
      devices: ["desktop", "mobile"],
      rulebookVersion: "test-rulebook",
    });
  });

  it("does not clear findings using another Market or rulebook's passing checks", () => {
    const { input, pass } = actionFixture();
    for (const change of [
      { countryCode: "DE" },
      { rulebookVersion: "different-rules" },
    ]) {
      pass.payload = { ...parsePublicSeoArtifact(focusedReport()), ...change };
      expect(projectSeoProjection(input).findings).toHaveLength(1);
    }
  });

  it("projects Search Console query rows and keeps one opportunity per Task across syncs", () => {
    const input = fixture();
    const older = searchObservation(input, "2026-11-02T12:00:00Z"),
      newer = searchObservation(input, "2026-11-03T12:00:00Z");
    input.observations = [newer, older];
    const first = projectSeoProjection(input);
    expect(first.searchQueries).toMatchObject({
      observationId: newer.id,
      from: "2026-10-09",
      to: "2026-11-05",
    });
    expect(first.searchQueries?.rows.map((row) => row.query)).toEqual([
      "battery health",
      "rare query",
    ]);
    // Only the row above the impression floor becomes a review suggestion.
    const opportunities = first.actions.filter(
      (row) => row.kind === "opportunity",
    );
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      observationId: newer.id,
      status: "recommended",
      taskId: null,
    });
    const taskId = randomUUID();
    input.actionTasks = [
      {
        id: randomUUID(),
        projectId: input.project.id,
        auditId: null,
        observationId: older.id,
        actionId: opportunities[0].id,
        taskId,
        idempotencyKey: "opportunity-test",
        createdAt: now,
      },
    ];
    input.tasks = [{ id: taskId, status: "READY", completedAt: null }];
    const linked = projectSeoProjection(input).actions.filter(
      (row) => row.kind === "opportunity",
    );
    expect(linked).toEqual([
      expect.objectContaining({
        id: opportunities[0].id,
        observationId: older.id,
        taskId,
        status: "task_created",
      }),
    ]);
  });

  it("shows the newest index verdict per selected page from any sync that inspected it", () => {
    const input = fixture();
    const other = "https://other.example.test/";
    const verdict = (pageUrl: string, value: "PASS" | "FAIL") => ({
      pageUrl,
      verdict: value,
      coverageState: null,
      robotsTxtState: null,
      lastCrawlTime: null,
      googleCanonical: null,
      userCanonical: null,
    });
    const base = searchObservation(input, "2026-11-01T12:00:00Z");
    // An older sync of a wider page group inspected this page and another one.
    const wide = {
      ...base,
      pageIds: [...input.scope.pageIds, randomUUID()],
      payload: {
        ...base.payload,
        pageUrls: [SEO_TEST_PAGE, other],
        indexedPages: [verdict(SEO_TEST_PAGE, "PASS"), verdict(other, "PASS")],
      },
    };
    const silent = searchObservation(input, "2026-11-02T12:00:00Z");
    input.observations = [silent, wide];
    expect(projectSeoProjection(input).indexStatus).toEqual({
      pages: [
        {
          ...verdict(SEO_TEST_PAGE, "PASS"),
          checkedAt: "2026-11-01T12:00:00.000Z",
        },
      ],
    });
    const newest = searchObservation(input, "2026-11-03T12:00:00Z");
    input.observations = [
      {
        ...newest,
        payload: {
          ...newest.payload,
          indexedPages: [verdict(SEO_TEST_PAGE, "FAIL")],
        },
      },
      silent,
      wide,
    ];
    expect(projectSeoProjection(input).indexStatus?.pages).toEqual([
      expect.objectContaining({
        verdict: "FAIL",
        checkedAt: "2026-11-03T12:00:00.000Z",
      }),
    ]);
  });

  it("keeps a Task linked from an observation outside the selected scope", () => {
    const input = fixture();
    const current = searchObservation(input, "2026-11-03T12:00:00Z");
    input.observations = [current];
    const [opportunity] = projectSeoProjection(input).actions.filter(
      (row) => row.kind === "opportunity",
    );
    const taskId = randomUUID();
    const elsewhere = randomUUID();
    input.actionTasks = [
      {
        id: randomUUID(),
        projectId: input.project.id,
        auditId: null,
        observationId: elsewhere,
        actionId: opportunity.id,
        taskId,
        idempotencyKey: "other-scope",
        createdAt: now,
      },
    ];
    input.tasks = [{ id: taskId, status: "COMPLETED", completedAt: now }];
    expect(
      projectSeoProjection(input).actions.filter(
        (row) => row.kind === "opportunity",
      ),
    ).toEqual([
      expect.objectContaining({
        id: opportunity.id,
        observationId: elsewhere,
        taskId,
        status: "implemented",
      }),
    ]);
  });

  it("skips a sync stored by a newer build but still refuses a broken one", () => {
    const input = fixture();
    const newer = metricObservation(input, "2026-11-03T12:00:00Z", 24);
    newer.payload = { ...(newer.payload as object), addedLater: true } as never;
    input.observations = [
      newer,
      metricObservation(input, "2026-11-02T12:00:00Z", 20),
    ];
    // An older build shows the sync it can read instead of failing the page.
    expect(projectSeoProjection(input).metrics.map((row) => row.value)).toEqual(
      [20],
    );
    newer.payload = { ...(newer.payload as object), provider: 7 } as never;
    expect(() => projectSeoProjection(input)).toThrow(
      "Stored analytics evidence is not readable",
    );
  });

  it("keeps every metric sync on the timeline while showing only the latest compatible total", () => {
    const input = fixture();
    input.observations = [
      metricObservation(input, "2026-11-03T12:00:00Z", 24),
      metricObservation(input, "2026-11-02T12:00:00Z", 20),
    ];
    const result = projectSeoProjection(input);
    expect(result.metrics.map((row) => row.value)).toEqual([24]);
    // Reopening statistics must retain the property the owner already chose.
    expect(result.metrics[0]).toHaveProperty("propertyId", "properties/123");
    expect(
      result.timeline.filter((row) => row.kind === "metrics"),
    ).toHaveLength(2);
    input.query = { from: "2026-11-02", to: "2026-11-02" };
    const outside = observation(
      input,
      parsePublicSeoArtifact(focusedReport()),
      "2026-11-03T12:00:00Z",
    );
    const inside = observation(
      input,
      parsePublicSeoArtifact(focusedReport()),
      "2026-11-02T12:00:00Z",
    );
    input.observations.push(outside, inside);
    const filtered = projectSeoProjection(input);
    // Audit activity dates never reinterpret the reporting period of a saved total.
    expect(filtered.metrics.map((row) => row.value)).toEqual([24]);
    expect(filtered.metrics[0]).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-31",
      propertyId: "properties/123",
    });
    expect(filtered.observations.map((row) => row.id)).toEqual([inside.id]);
    expect(
      filtered.timeline.filter((row) => row.kind === "metrics"),
    ).toHaveLength(1);
    expect(
      filtered.timeline.every((row) => row.at.startsWith("2026-11-02")),
    ).toBe(true);
  });

  it("keeps a newer Discover sync out of the web search view", () => {
    const input = fixture();
    const web = searchObservation(input, "2026-11-02T12:00:00Z");
    const discover = searchObservation(input, "2026-11-03T12:00:00Z");
    discover.payload = {
      ...(discover.payload as object),
      searchType: "discover",
      queries: undefined,
      metrics: [
        {
          key: "clicks",
          label: "Search clicks",
          unit: "count",
          value: 7,
          points: [],
        },
      ],
    } as never;
    input.observations = [discover, web];
    const webView = projectSeoProjection(input);
    expect(webView.metrics).toEqual([]);
    expect(webView.searchQueries?.observationId).toBe(web.id);
    input.query = { searchType: "discover" };
    const discoverView = projectSeoProjection(input);
    expect(discoverView.metrics.map((row) => row.value)).toEqual([7]);
    expect(discoverView.metrics[0]).toMatchObject({ searchType: "discover" });
    expect(discoverView.searchQueries).toBeNull();
  });

  it("keeps new import and action activity when their scoped evidence was measured earlier", () => {
    const { input, original } = actionFixture();
    const activityAt = new Date("2026-11-04T12:00:00Z");
    const activityDay = activityAt.toISOString().slice(0, 10);
    const focused = observation(
      input,
      parsePublicSeoArtifact(focusedReport()),
      "2026-11-01T12:00:00Z",
    );
    original.createdAt = activityAt;
    focused.createdAt = activityAt;
    const link = input.actionTasks[0];
    link.createdAt = activityAt;
    input.query = { from: activityDay, to: activityDay };
    input.observations = [focused, original];

    const result = projectSeoProjection(input);
    expect(result.observations).toEqual([]);
    expect(result.timeline).toHaveLength(3);
    expect(result.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `observation:${original.id}`,
          title: "SEO audit imported",
          at: activityAt.toISOString(),
        }),
        expect.objectContaining({
          id: `observation:${focused.id}`,
          title: "SEO check results imported",
          at: activityAt.toISOString(),
        }),
        expect.objectContaining({
          id: `action:${link.id}`,
          at: activityAt.toISOString(),
          observationId: original.id,
          taskId: link.taskId,
        }),
      ]),
    );

    input.observations = [{ ...original, pageIds: [randomUUID()] }];
    expect(projectSeoProjection(input).timeline).toEqual([]);

    const privateMetric = metricObservation(
      input,
      activityAt.toISOString(),
      24,
    );
    link.observationId = privateMetric.id;
    input.observations = [privateMetric];
    const privateResult = projectSeoProjection(input);
    expect(privateResult.timeline).toHaveLength(1);
    expect(privateResult.timeline[0]).toMatchObject({
      id: `metrics:${privateMetric.id}`,
      kind: "metrics",
    });
  });

  it("shows an action as solved when a later check passes, whatever its Task does", () => {
    const { input } = actionFixture();
    const [task] = input.tasks;
    // The issue is gone while the Task is still open.
    input.tasks = [{ ...task, status: "RUNNING", completedAt: null }];
    expect(projectSeoProjection(input).actions).toMatchObject([
      { status: "verified", taskId: task.id },
    ]);
    // A Task that was cancelled, failed or is gone does no work: its action leaves the list like one without a Task.
    for (const tasks of [
      [],
      [{ ...task, status: "CANCELED" }],
      [{ ...task, status: "FAILED" }],
    ]) {
      input.tasks = tasks;
      expect(
        projectSeoProjection(input).actions,
        JSON.stringify(tasks),
      ).toHaveLength(0);
    }
  });

  it("requires a later compatible explicit pass to verify an implemented action", () => {
    const { input, pass } = actionFixture();
    expect(projectSeoProjection(input).actions[0].status).toBe("verified");
    for (const mutation of [
      { countryCode: "DE" },
      { languageCode: "de" },
      { rulebookVersion: "changed-rulebook" },
      {
        checks: [
          {
            rowId: "title",
            pageUrl: SEO_TEST_PAGE,
            device: "mobile",
            result: "pass",
          },
        ],
      },
      {
        checks: [
          {
            rowId: "title",
            pageUrl: SEO_TEST_PAGE,
            device: "desktop",
            result: "fired",
          },
        ],
      },
    ]) {
      const payload = parsePublicSeoArtifact(focusedReport());
      pass.payload = { ...payload, ...mutation };
      expect(
        projectSeoProjection(input).actions[0].status,
        JSON.stringify(mutation),
      ).toBe("implemented");
    }
    // The newest check passes before the Task ended: the issue is gone all the same, so the action is solved.
    pass.payload = parsePublicSeoArtifact(focusedReport());
    pass.observedAt = new Date("2026-11-02T11:00:00Z");
    expect(projectSeoProjection(input).actions[0].status).toBe("verified");
  });

  it("does not clear an unrelated finding when a focused check skips its row", () => {
    const { input, pass } = actionFixture();
    const payload = parsePublicSeoArtifact(focusedReport());
    pass.payload = {
      ...payload,
      checks: [
        {
          rowId: "description",
          pageUrl: SEO_TEST_PAGE,
          device: "desktop",
          result: "pass",
        },
      ],
    };
    expect(projectSeoProjection(input).findings).toHaveLength(1);
    pass.payload = payload;
    expect(projectSeoProjection(input).findings).toHaveLength(0);
  });

  it("keeps Google redirect candidates unconfirmed and preserves human keyword choices", () => {
    const { input } = actionFixture();
    input.keywords = [
      {
        id: randomUUID(),
        projectId: input.project.id,
        auditId: null,
        keyword: "example",
        keywordKey: "example",
        countryCode: "US",
        languageCode: "en",
        pageId: input.pages[0].id,
        priority: "high",
        saved: true,
        version: 2,
        updatedAt: now,
      },
    ];
    const result = projectSeoProjection(input);
    expect(
      result.keywords.find((row) => row.keyword === "example"),
    ).toMatchObject({ saved: true, priority: "high", version: 2 });
    expect(
      result.competitors.find((row) => row.role === "competitor"),
    ).toMatchObject({ confirmed: false, canConfirm: false });
  });
});
