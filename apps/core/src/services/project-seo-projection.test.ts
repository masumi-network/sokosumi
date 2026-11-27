import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type PublicSeoPayload,
  parsePublicSeoArtifact,
} from "@/helpers/project-seo-report";
import { normalizeGscStatistics } from "@/lib/seo/native-statistics";
import { nativeSeoMetricsSchema } from "@/schemas/project-seo-native-metrics.schema";
import { seoWorkspaceLandingPagesSchema } from "@/schemas/project-seo-traffic.schema";
import {
  focusedReport,
  legacyReport,
  SEO_TEST_PAGE,
  SEO_TEST_SECOND_PAGE,
  siteStrategyReport,
} from "@/test-fixtures/project-seo";
import workerInsights from "./__tests__/fixtures/seo-seasonal-worker-insights.json";

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
    historyLimited: false,
    evidenceLimited: false,
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
      { ...issue, id: "fragment", pageUrl: `${issue.pageUrl}#details` },
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

  it("keeps the issue when a diagnostic precedes it on the same row and device", () => {
    const input = fixture();
    const payload = parsePublicSeoArtifact(legacyReport());
    const [issue] = payload.findings;
    payload.findings.unshift({ ...issue, id: "measurement", severity: "note" });
    const audit = observation(input, payload, "2026-11-01T12:00:00Z");
    input.observations = [audit];

    const view = projectSeoProjection(input);
    expect(view.runs?.[0].issues).toBe(1);
    expect(view.findings.map((item) => item.id)).toContain(
      `${audit.id}:${issue.id}`,
    );
  });

  it.each([
    { checked: 0, skipped: 2, failed: 0 },
    { checked: 1, skipped: 0, failed: 1 },
    {
      checked: 1,
      skipped: 0,
      failed: 0,
      modules: { notRequested: 0, failed: 1 },
    },
  ])(
    "keeps an incomplete zero unknown in the timeline, including outside the period",
    (coverage) => {
      const input = fixture();
      const payload = parsePublicSeoArtifact(legacyReport());
      payload.checks = [];
      payload.coverage = coverage;
      payload.findings = [];
      input.observations = [
        observation(input, payload, "2026-11-01T12:00:00Z"),
      ];
      input.query = { from: "2026-11-02" };
      expect(projectSeoProjection(input).runs?.[0].issues).toBeNull();
    },
  );

  it("counts a private index issue even when the audit measured no public checks", () => {
    const input = fixture();
    const payload = parsePublicSeoArtifact(legacyReport());
    payload.checks = [];
    payload.coverage = { checked: 0, skipped: 1, failed: 0 };
    payload.findings = [];
    const audit = observation(input, payload, "2026-11-01T12:00:00Z");
    const taskId = randomUUID();
    audit.sourceTaskId = taskId;
    input.observations = [
      audit,
      {
        ...audit,
        id: randomUUID(),
        kind: "index_triage",
        source: "seo_worker",
        ownerId: randomUUID(),
        payload: {
          version: 1,
          taskId,
          receiptHash: "a".repeat(64),
          checkedAt: now.toISOString(),
          assessments: [
            {
              pageUrl: SEO_TEST_PAGE,
              status: "issue",
              report: true,
              reason: "Missing from search",
              suggestedFix: null,
              evidence: [],
            },
          ],
        },
      },
    ];
    const view = projectSeoProjection(input);
    expect(view.runs?.[0].issues).toBe(1);
    expect(view.findings).toHaveLength(1);
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

  it("gives a check the diff against the earlier check of its kind, with the issue counts of the runs row", () => {
    const input = fixture();
    const audit = (at: string) =>
      observation(input, parsePublicSeoArtifact(legacyReport()), at);
    input.observations = [
      audit("2026-11-02T12:00:00Z"),
      audit("2026-11-01T12:00:00Z"),
    ];
    const [latest, first] = projectSeoProjection(input).runs ?? [];
    expect(latest.runDiff).toMatchObject({
      from: "2026-11-01T12:00:00.000Z",
      to: "2026-11-02T12:00:00.000Z",
      comparable: true,
      newCount: 0,
      stillOpenCount: 1,
      numbers: { issues: { from: 1, to: 1 } },
    });
    expect(first.runDiff).toBeUndefined();
  });

  it("compares the oldest check it shows with an older check that only the comparison reads", () => {
    const input = fixture();
    const audit = (at: string) =>
      observation(input, parsePublicSeoArtifact(legacyReport()), at);
    const older = audit("2026-11-01T12:00:00Z");
    input.observations = [audit("2026-11-02T12:00:00Z")];
    input.diffBaselines = [
      { ...older, payload: parsePublicSeoArtifact(legacyReport()) },
    ];
    const runs = projectSeoProjection(input).runs ?? [];
    // The older check is no run of its own: it is the base of the one shown.
    expect(runs).toHaveLength(1);
    expect(runs[0].runDiff).toMatchObject({
      from: "2026-11-01T12:00:00.000Z",
      comparable: true,
      stillOpenCount: 1,
    });
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

  it("retains measured site intent and a matching purpose opportunity only in the scope they describe", () => {
    const input = fixture(),
      base = siteStrategyReport(),
      report = legacyReport();
    const second = {
      ...input.pages[0],
      url: SEO_TEST_SECOND_PAGE,
      id: randomUUID(),
    };
    input.pages.push(second);
    const fullScope = {
      ...input.scope,
      pageIds: input.pages.map((p) => p.id),
      pages: input.pages,
    };
    const raw = {
      ...base,
      pages: [report, { ...report, request: { url: second.url } }],
      strategy: {
        ...base.strategy,
        groups: base.strategy.groups.map((g, index) =>
          index === 1 ? { ...g, reach: "out of reach" } : g,
        ),
        purpose: "sales",
        purposeSource: "owner",
        demandByIntent: { buyer: 47, informational: 20, other: 0 },
        missingDemandByIntent: { buyer: 0, informational: 0, other: 1 },
        purposeOpportunity: {
          page: 1,
          keyword: "example",
          demand: 47,
          reach: "in reach",
        },
      },
    };
    const imported = parsePublicSeoArtifact(raw);
    const row = observation(
      { ...input, scope: fullScope },
      imported,
      now.toISOString(),
    );
    const read = (scope: Input["scope"], observationRow = row) =>
      projectSeoProjection({ ...input, scope, observations: [observationRow] })
        .strategy;
    expect(read(fullScope)).toMatchObject({
      purpose: "sales",
      purposeSource: "owner",
      demandByIntent: raw.strategy.demandByIntent,
      missingDemandByIntent: raw.strategy.missingDemandByIntent,
      purposeOpportunity: {
        pageUrl: SEO_TEST_PAGE,
        keyword: "example",
        demand: 47,
        reach: "in reach",
      },
      groups: expect.arrayContaining([
        expect.objectContaining({
          lead: "second term",
          reach: "out of reach",
          forums: true,
        }),
      ]),
    });
    expect(read(input.scope)).toMatchObject({
      purpose: "sales",
      purposeOpportunity: { pageUrl: SEO_TEST_PAGE },
    });
    const narrowed = read({
      ...input.scope,
      pages: [second],
      pageIds: [second.id],
    });
    for (const field of [
      "purposeOpportunity",
      "demandByIntent",
      "missingDemandByIntent",
    ])
      expect(narrowed).not.toHaveProperty(field);
    expect(narrowed?.groups).toHaveLength(1);
    const malformed = {
      ...raw,
      strategy: {
        ...raw.strategy,
        purposeSource: "made up",
        purposeOpportunity: { ...raw.strategy.purposeOpportunity, page: 2 },
        demandByIntent: { buyer: -1, informational: 20, other: 0 },
        groups: raw.strategy.groups.map((g) => ({ ...g, forums: "invalid" })),
      },
    };
    const partlyRead = parsePublicSeoArtifact(malformed).strategy;
    expect(partlyRead).toMatchObject({
      purpose: "sales",
      missingDemandByIntent: raw.strategy.missingDemandByIntent,
      verdict: "keep",
    });
    for (const field of [
      "purposeSource",
      "purposeOpportunity",
      "demandByIntent",
    ])
      expect(partlyRead?.[field as keyof typeof partlyRead]).toBeUndefined();
    expect(partlyRead?.groups[0].forums).toBeUndefined();
    expect(
      read(fullScope, {
        ...row,
        payload: {
          ...imported,
          strategy: {
            ...imported.strategy!,
            purposeOpportunity: "bad historical value",
            groups: imported.strategy!.groups.map((g) => ({
              ...g,
              forums: "unknown",
            })),
          },
        },
      }),
    ).toMatchObject({ purpose: "sales", verdict: "keep" });
    for (const opportunity of [
      { page: 1, keyword: "other", demand: 47, reach: "in reach" },
      { ...raw.strategy.purposeOpportunity, reach: "ranks" },
      { ...raw.strategy.purposeOpportunity, demand: 999 },
    ])
      expect(
        parsePublicSeoArtifact({
          ...raw,
          strategy: { ...raw.strategy, purposeOpportunity: opportunity },
        }).strategy?.purposeOpportunity,
      ).toBeUndefined();
    const unsupportedTotals = parsePublicSeoArtifact({
      ...raw,
      strategy: {
        ...raw.strategy,
        demandByIntent: { buyer: 999, informational: 20, other: 0 },
        missingDemandByIntent: { buyer: 0, informational: 0, other: 200 },
      },
    }).strategy;
    expect(unsupportedTotals?.purposeOpportunity).toBeDefined();
    expect(unsupportedTotals?.demandByIntent).toBeUndefined();
    expect(unsupportedTotals?.missingDemandByIntent).toBeUndefined();
    const ambiguous = parsePublicSeoArtifact({
      ...raw,
      selection: {
        ...raw.selection,
        pages: [...raw.selection.pages, raw.selection.pages[0]],
      },
    });
    expect(ambiguous.strategy?.purposeOpportunity).toBeUndefined();
    const skipped = parsePublicSeoArtifact({
      ...raw,
      pages: [report],
      strategy: {
        ...raw.strategy,
        groups: [{ ...base.strategy.groups[0], page: 2 }],
        purposeOpportunity: { ...raw.strategy.purposeOpportunity, page: 2 },
      },
    });
    expect(skipped.strategy?.purposeOpportunity).toBeUndefined();
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

  it("names each fix by its issue in the newest compared check, and drops a proposal that check fixed", () => {
    const input = fixture();
    const base = parsePublicSeoArtifact(legacyReport());
    const page = base.findings[0].pageUrl;
    const fired = (rowId: string) => ({
      rowId,
      pageUrl: page,
      device: "desktop" as const,
      result: "fired" as const,
    });
    const finding = (rowId: string, device: "desktop" | null = "desktop") => ({
      ...base.findings[0],
      id: `finding:${rowId}`,
      rowId,
      device,
    });
    const fix = (id: string, rowId: string) => ({
      ...base.actions[0],
      id,
      findingIds: [`finding:${rowId}`],
    });
    // A finding without a device: no exact later pass on its device can end its proposal.
    const earlier = observation(
      input,
      {
        ...base,
        checks: [fired("title"), fired("h1"), fired("meta")],
        findings: [finding("title", null), finding("h1"), finding("meta")],
        actions: [fix("1", "title"), fix("2", "h1"), fix("3", "meta")],
      },
      "2026-11-01T12:00:00Z",
    );
    const latest = observation(
      input,
      {
        ...base,
        checks: [{ ...fired("title"), result: "pass" }, fired("h1")],
        findings: [finding("h1")],
        actions: [],
      },
      "2026-11-03T12:00:00Z",
    );
    input.observations = [latest, earlier];
    const results = () =>
      projectSeoProjection(input).actions.map(({ id, lastCheckResult }) => ({
        id,
        lastCheckResult,
      }));
    // The title passes now, the h1 still fails, and the newest check did not test the meta rule again.
    expect(results()).toEqual([
      { id: "2", lastCheckResult: "failing" },
      { id: "3", lastCheckResult: undefined },
    ]);
    // A newest check of another Market compares nothing: every fix stays as it was.
    latest.payload = {
      ...(latest.payload as object),
      countryCode: "DE",
    } as typeof latest.payload;
    expect(results()).toEqual(
      ["1", "2", "3"].map((id) => ({ id, lastCheckResult: undefined })),
    );
  });

  it("keeps a fix through a later pass, a fix on another device, and a check after the period", () => {
    const input = fixture();
    const base = parsePublicSeoArtifact(legacyReport());
    const page = base.findings[0].pageUrl;
    const row = (device: "desktop" | "mobile", result: "fired" | "pass") => ({
      rowId: "title",
      pageUrl: page,
      device,
      result,
    });
    const finding = (device: "desktop" | "mobile" | null) => ({
      ...(base.findings[0] as object),
      id: "finding:title",
      rowId: "title",
      device,
    });
    const check = (
      checks: ReturnType<typeof row>[],
      findings: ReturnType<typeof finding>[],
      at: string,
      fixes = 0,
    ) =>
      observation(
        input,
        {
          ...base,
          checks,
          findings,
          actions: fixes
            ? [
                {
                  ...(base.actions[0] as object),
                  id: "1",
                  findingIds: ["finding:title"],
                },
              ]
            : [],
        } as PublicSeoPayload,
        at,
      );
    const ids = () => projectSeoProjection(input).actions.map(({ id }) => id);
    const rowOf = (result: "fired" | "pass") => row("desktop", result);
    // Fail, pass, pass: the second pass reads no open issue, and the first one still ended the proposal.
    input.observations = [
      check([row("desktop", "pass")], [], "2026-11-05T12:00:00Z"),
      check([row("desktop", "pass")], [], "2026-11-03T12:00:00Z"),
      check(
        [row("desktop", "fired")],
        [finding(null)],
        "2026-11-01T12:00:00Z",
        1,
      ),
    ];
    expect(ids()).toEqual([]);
    // A period that ends before the passes shows the proposal its checks still hold.
    input.query = { to: "2026-11-02" };
    expect(ids()).toEqual(["1"]);
    input.query = {};
    // A fix for mobile is not tested again by checks that read desktop only.
    input.observations = [
      check([row("desktop", "pass")], [], "2026-11-05T12:00:00Z"),
      check(
        [row("desktop", "fired")],
        [finding("desktop")],
        "2026-11-03T12:00:00Z",
      ),
      check(
        [row("mobile", "fired")],
        [finding("mobile")],
        "2026-11-01T12:00:00Z",
        1,
      ),
    ];
    expect(
      projectSeoProjection(input).actions.map(({ id, lastCheckResult }) => ({
        id,
        lastCheckResult,
      })),
    ).toEqual([{ id: "1", lastCheckResult: undefined }]);
    // Pass, fail in an audit, pass: the two focused checks agree, and the newest one still answers the audit's fix.
    const focused = (at: string) => {
      const row = check([{ ...rowOf("pass") }], [], at);
      row.kind = "page_check";
      row.payload = {
        ...(row.payload as object),
        kind: "page_check",
      } as PublicSeoPayload;
      return row;
    };
    input.observations = [
      focused("2026-11-05T12:00:00Z"),
      check([rowOf("fired")], [finding(null)], "2026-11-03T12:00:00Z", 1),
      focused("2026-11-01T12:00:00Z"),
    ];
    expect(ids()).toEqual([]);
    const tags = () =>
      projectSeoProjection(input).actions.map(({ id, lastCheckResult }) => ({
        id,
        lastCheckResult,
      }));
    const h1 = { ...rowOf("pass"), rowId: "h1" };
    // Fail, pass, then a check of another rule: the pass still answers the fix.
    input.observations = [
      check([h1], [], "2026-11-05T12:00:00Z"),
      check([rowOf("pass")], [], "2026-11-03T12:00:00Z"),
      check([rowOf("fired")], [finding(null)], "2026-11-01T12:00:00Z", 1),
    ];
    expect(ids()).toEqual([]);
    // Fail, pass, then a row that fires without a finding: the fix fails again.
    input.observations[0] = check([rowOf("fired")], [], "2026-11-05T12:00:00Z");
    expect(tags()).toEqual([{ id: "1", lastCheckResult: "failing" }]);
    // A finding without a device that fired on both devices: desktop passes leave mobile untested.
    input.observations = [
      check([rowOf("pass")], [], "2026-11-05T12:00:00Z"),
      check([rowOf("pass")], [], "2026-11-03T12:00:00Z"),
      check(
        [rowOf("fired"), row("mobile", "fired")],
        [finding(null)],
        "2026-11-01T12:00:00Z",
        1,
      ),
    ];
    expect(tags()).toEqual([{ id: "1", lastCheckResult: undefined }]);
    // A fix for mobile does not fail on a desktop failure.
    input.observations = [
      check([rowOf("fired")], [finding("desktop")], "2026-11-05T12:00:00Z"),
      check(
        [row("mobile", "fired")],
        [finding("mobile")],
        "2026-11-01T12:00:00Z",
        1,
      ),
    ];
    expect(tags()).toEqual([{ id: "1", lastCheckResult: undefined }]);
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

  it("shows one issue and one fix when a later check under a newer rulebook finds the issue again", () => {
    const { input, original } = actionFixture();
    input.actionTasks = [];
    const latest = observation(
      input,
      {
        ...parsePublicSeoArtifact(legacyReport()),
        rulebookVersion: "newer-rulebook",
      },
      "2026-11-04T12:00:00Z",
    );
    input.observations = [latest, original];
    const result = projectSeoProjection(input);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(
      new Set(result.actions.map((action) => action.observationId)),
    ).toEqual(new Set([latest.id]));
    expect(result.findings.length).toBeGreaterThan(0);
    expect(new Set(result.findings.map((item) => item.observationId))).toEqual(
      new Set([latest.id]),
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
            intentClass: "comparison",
            fit: "direct",
          },
        ],
      },
    });
    input.observations = [
      observation(input, estimated, "2026-11-03T12:00:00Z"),
      original,
    ];
    const { keywords } = projectSeoProjection(input);
    // The reason of the estimate goes with it: the reader sees why the level is high.
    expect(
      keywords.find((row) => row.keyword === "estimated idea"),
    ).toMatchObject({
      conversion: "high",
      feature: "Low battery alerts",
      intentClass: "comparison",
      fit: "direct",
    });
    // A row without an estimate says null, not "low".
    expect(keywords.find((row) => row.keyword === "gap term")).toMatchObject({
      conversion: null,
      feature: null,
      intentClass: null,
      fit: null,
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

  it("populates the personal Traffic card from a real normalized 90-day Search Console read and rejects a failed retained period", async () => {
    // Exercise the Web consumer across the two apps' runtime boundary. Neither app imports the other's source in its build.
    const { seoSearchPeriodInsight } = await vi.importActual<{
      seoSearchPeriodInsight: (...input: unknown[]) => unknown;
    }>(
      "../../../web/src/app/(app)/seo/components/seo-search-period-insight-model.ts",
    );
    const input = fixture();
    input.sharing = "personal";
    const observedAt = "2026-04-05T12:00:00Z";
    const query = {
      provider: "search_console" as const,
      propertyId: "sc-domain:example.com",
      pageUrls: [SEO_TEST_PAGE],
      from: "2026-01-01",
      to: "2026-03-31",
      channel: "organic" as const,
    };
    const day = (i: number) =>
      new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const daily = {
      rows: Array.from({ length: 90 }, (_, i) => {
        const clicks = i < 83 ? 10 : 6;
        return {
          keys: [day(i)],
          clicks,
          impressions: 100,
          ctr: clicks / 100,
          position: 5,
        };
      }),
    };
    const aggregate = {
      rows: [{ clicks: 872, impressions: 9000, ctr: 872 / 9000, position: 5 }],
    };
    const project = (
      aggregateRead: typeof aggregate | null,
      dailyRead = daily,
    ) => {
      const payload = normalizeGscStatistics(
        query,
        aggregateRead,
        dailyRead,
        observedAt,
      );
      expect(payload.coverage).toBe("partial");
      input.observations = [
        {
          ...metricObservation(input, observedAt, 0),
          source: "search_console",
          payload,
        },
      ];
      const workspace = projectSeoProjection(input);
      const rows = workspace.metrics.map((row) => ({
        ...row,
        observedAt: new Date(row.observedAt),
        selectedAt: row.selectedAt ? new Date(row.selectedAt) : undefined,
      }));
      return seoSearchPeriodInsight(workspace.sharing, rows, workspace.scope);
    };
    expect(project(aggregate)).toMatchObject({
      property: query.propertyId,
      previous: { from: "2026-03-18", to: "2026-03-24" },
      current: { from: "2026-03-25", to: "2026-03-31" },
      beforeClicks: 70,
      afterClicks: 42,
      beforeImpressions: 700,
      afterImpressions: 700,
    });
    expect(project(null)).toBeNull();
    expect(
      project(aggregate, { rows: daily.rows.filter((_row, i) => i !== 86) }),
    ).toBeNull();
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
    // Selecting the older report again changes its activation time, not Google's read time.
    const reactivated = searchObservation(input, "2026-11-04T12:00:00Z");
    input.observations.unshift({
      ...reactivated,
      pageIds: wide.pageIds,
      payload: {
        ...wide.payload,
        observedAt: reactivated.observedAt.toISOString(),
        collectedAt: wide.observedAt.toISOString(),
      },
    });
    expect(projectSeoProjection(input).indexStatus?.pages).toEqual([
      expect.objectContaining({
        verdict: "FAIL",
        checkedAt: newest.observedAt.toISOString(),
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

  it("retains the original sync event and Google dates after cached selection, including legacy collections", () => {
    const input = fixture();
    const measured = "2026-11-03T12:00:00.000Z",
      selected = "2026-11-04T11:00:00.000Z";
    const first = searchObservation(input, measured);
    const fingerprint = "a".repeat(64);
    const original = {
      ...first,
      payload: { ...first.payload, collectionFingerprint: fingerprint },
    };
    const activation = {
      ...original,
      id: randomUUID(),
      observedAt: new Date(selected),
      createdAt: new Date(selected),
      payload: {
        ...original.payload,
        collectedAt: measured,
        observedAt: selected,
      },
    };
    input.observations = [activation, original];
    const result = projectSeoProjection(input);
    expect(
      result.timeline.filter((row) => row.kind === "metrics"),
    ).toMatchObject([{ at: measured, observationId: original.id }]);
    expect(result.searchQueries?.observedAt).toBe(measured);
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

  it("withholds stored GA4 comparisons with unequal windows while keeping totals and compatible comparisons", () => {
    const input = fixture();
    const row = metricObservation(input, "2026-11-03T12:00:00Z", 24);
    const validPrevious = {
      from: "2026-09-29",
      to: "2026-09-30",
      value: 12,
    };
    for (const invalidPrevious of [
      { from: "2026-09-30", to: "2026-09-30", value: 12 },
      { from: "2026-09-28", to: "2026-09-29", value: 12 },
    ]) {
      input.observations = [
        {
          ...row,
          payload: {
            ...row.payload,
            from: "2026-10-01",
            to: "2026-10-02",
            metrics: [
              { ...row.payload.metrics[0], previous: invalidPrevious },
              {
                ...row.payload.metrics[0],
                key: "page_views",
                label: "Page views",
                previous: validPrevious,
              },
            ],
          },
        },
      ];
      const result = projectSeoProjection(input);
      expect(result.metrics[0]).toMatchObject({ value: 24, points: [] });
      expect(result.metrics[0].previous).toBeUndefined();
      expect(result.metrics[1].previous).toEqual(validPrevious);
    }
  });

  it("retains a Search Console comparison shortened to its settled reporting period", () => {
    const input = fixture();
    const row = searchObservation(input, "2026-10-04T12:00:00Z");
    const previous = {
      from: "2026-09-30",
      to: "2026-09-30",
      value: 4,
    };
    input.observations = [
      {
        ...row,
        payload: {
          ...row.payload,
          from: "2026-10-01",
          to: "2026-10-02",
          metrics: [
            {
              key: "clicks",
              label: "Search clicks",
              unit: "count",
              value: 8,
              points: [],
              previous,
            },
          ],
        },
      },
    ];
    expect(projectSeoProjection(input).metrics[0]).toMatchObject({
      value: 8,
      previous,
    });
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

  it("shows a Discover split by device without query rows", () => {
    const input = fixture();
    const discover = searchObservation(input, "2026-11-03T12:00:00Z");
    const devices = {
      rowLimit: 250,
      truncated: false,
      rows: [
        {
          key: "mobile",
          clicks: 3,
          impressions: 40,
          ctr: 0.075,
          averagePosition: null,
        },
      ],
    };
    discover.payload = {
      ...(discover.payload as object),
      searchType: "discover",
      queries: undefined,
      feedDevices: devices,
    } as never;
    input.observations = [discover];
    input.query = { searchType: "discover" };
    const view = projectSeoProjection(input);
    expect(view.searchQueries).toBeNull();
    expect(view.searchBreakdown).toMatchObject({
      observationId: discover.id,
      devices,
    });
  });

  it("shows no older split beside query rows whose own split read failed", () => {
    const input = fixture();
    const older = searchObservation(input, "2026-11-02T12:00:00Z");
    older.payload = {
      ...(older.payload as object),
      devices: {
        rowLimit: 250,
        truncated: false,
        rows: [
          {
            key: "mobile",
            clicks: 3,
            impressions: 40,
            ctr: 0.075,
            averagePosition: 2,
          },
        ],
      },
    } as never;
    const newer = searchObservation(input, "2026-11-03T12:00:00Z");
    input.observations = [newer, older];
    const view = projectSeoProjection(input);
    expect(view.searchQueries?.observationId).toBe(newer.id);
    expect(view.searchBreakdown).toBeNull();
  });

  it("names the search type of image query rows and none for web rows", () => {
    const input = fixture();
    const image = searchObservation(input, "2026-11-03T12:00:00Z");
    image.payload = {
      ...(image.payload as object),
      searchType: "image",
    } as never;
    input.observations = [image];
    input.query = { searchType: "image" };
    expect(projectSeoProjection(input).searchQueries?.searchType).toBe("image");
    input.observations = [searchObservation(input, "2026-11-02T12:00:00Z")];
    input.query = {};
    const web = projectSeoProjection(input).searchQueries;
    expect(web).not.toBeNull();
    expect(web).not.toHaveProperty("searchType");
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
    // An open Task has no completion day to mark, also when it completed once and was reopened.
    expect(projectSeoProjection(input).actions[0].completedAt).toBeUndefined();
    input.tasks = [{ ...task, status: "RUNNING" }];
    expect(projectSeoProjection(input).actions[0].completedAt).toBeUndefined();
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
    // The dates a chart marks: the Task's completion and the check that confirmed the fix.
    expect(projectSeoProjection(input).actions[0]).toMatchObject({
      status: "verified",
      completedAt: input.tasks[0].completedAt?.toISOString(),
      verifiedAt: pass.observedAt.toISOString(),
    });
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
      const [action] = projectSeoProjection(input).actions;
      expect(action.status, JSON.stringify(mutation)).toBe("implemented");
      expect(action.verifiedAt, JSON.stringify(mutation)).toBeUndefined();
      expect(action.completedAt).toBe(
        input.tasks[0].completedAt?.toISOString(),
      );
    }
    // The newest check passes before the Task ended: the issue is gone all the same, so the action is solved.
    pass.payload = parsePublicSeoArtifact(focusedReport());
    pass.observedAt = new Date("2026-11-02T11:00:00Z");
    expect(projectSeoProjection(input).actions[0]).toMatchObject({
      status: "verified",
      verifiedAt: "2026-11-02T11:00:00.000Z",
    });
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

it("keeps seasonal suggestions within their audited page and market and retires them after a fresh full audit", () => {
  const input = fixture();
  const raw = legacyReport();
  const idea = {
    keyword: "canvas storage",
    audience: "sailboat owners",
    url: SEO_TEST_PAGE,
    asOf: "2026-11-01",
    country: raw.header.market.country,
    language: raw.header.market.language,
    pageQuote: "Cover your canvas before storing it.",
    event: null,
    action: "investigate_angle",
    limitations: ["timing_uncertain"],
    comparison: null,
    windows: [
      {
        targetPeriod: "2026-12",
        historicalPeriod: "2025-12",
        historicalVolume: 95,
        baselineMedian: 10,
        referenceMonths: [
          "2026-03",
          "2026-04",
          "2026-05",
          "2026-06",
          "2026-07",
          "2026-08",
        ],
      },
    ],
  };
  const read = parsePublicSeoArtifact({
    ...raw,
    seasonalReview: {
      insights: [
        idea,
        { keyword: "incomplete row" },
        { ...idea, url: SEO_TEST_SECOND_PAGE },
        { ...idea, country: "GB" },
      ],
    },
  });
  expect(read.seasonalIdeas).toEqual([idea]);
  const article = SEO_TEST_PAGE + "?p=42";
  const redirectedArticle = SEO_TEST_SECOND_PAGE + "?p=42";
  const redirectedIdea = {
    ...idea,
    keyword: "winter cover",
    url: redirectedArticle,
  };
  const articlePayload = parsePublicSeoArtifact({
    ...raw,
    request: { url: article },
    header: {
      ...raw.header,
      finalUrl: { mobile: redirectedArticle + "#mast" },
    },
    seasonalReview: {
      insights: [
        { ...idea, url: article },
        redirectedIdea,
        { ...idea, url: SEO_TEST_PAGE + "?p=43" },
        { ...idea, url: SEO_TEST_PAGE },
      ],
    },
  });
  expect(articlePayload.seasonalIdeas).toEqual([
    { ...idea, url: article },
    { ...redirectedIdea, url: article },
  ]);
  input.observations = [observation(input, read, raw.header.capturedAt)];
  expect(projectSeoProjection(input).seasonalIdeas).toEqual([idea]);
  input.observations.unshift(
    observation(input, parsePublicSeoArtifact(raw), "2026-11-02T12:00:00Z"),
  );
  expect(projectSeoProjection(input).seasonalIdeas).toBeUndefined();

  const britishIdea = { ...idea, country: "GB" };
  const british = parsePublicSeoArtifact({
    ...raw,
    header: { ...raw.header, market: { country: "GB", language: "en" } },
    seasonalReview: { insights: [britishIdea] },
  });
  const mixedSite = parsePublicSeoArtifact({
    ...siteStrategyReport(),
    pages: [
      raw,
      {
        ...raw,
        request: { url: SEO_TEST_SECOND_PAGE },
        header: { ...raw.header, market: { country: "GB", language: "en" } },
        seasonalReview: {
          insights: [{ ...britishIdea, url: SEO_TEST_SECOND_PAGE }],
        },
      },
    ],
  });
  expect(mixedSite.seasonalIdeas ?? []).toEqual([]);
  input.observations = [
    observation(
      input,
      { ...read, seasonalIdeas: british.seasonalIdeas },
      "2026-11-02T12:00:00Z",
    ),
    observation(input, british, raw.header.capturedAt),
  ];
  expect(projectSeoProjection(input).seasonalIdeas).toEqual([britishIdea]);
});

it("imports a worker seasonal review with its measured history and offers the supported update as work", () => {
  const input = fixture();
  const raw = legacyReport();
  const market = raw.header.market;
  const insights = workerInsights.map((row) => ({
    ...row,
    url: SEO_TEST_PAGE,
    country: market.country,
    language: market.language,
  }));
  const payload = parsePublicSeoArtifact({
    ...raw,
    seasonalReview: {
      status: { demand: "completed", audience: "completed" },
      insights,
    },
  });
  input.observations = [observation(input, payload, raw.header.capturedAt)];
  const result = projectSeoProjection(input, new Date("2026-11-19T12:00:00Z"));
  const [rise, flat] = result.seasonalIdeas ?? [];
  expect(flat).toMatchObject({ keyword: "segelpflege", windows: [] });
  expect(flat.observedMonths).toHaveLength(34);
  expect(flat.observedMonths?.at(-1)).toEqual({
    period: "2026-10",
    volume: 50,
  });
  expect(flat.actionId).toBeUndefined();
  expect(rise.actionId).toMatch(/^seasonal:/);
  expect(result.actions.find((a) => a.id === rise.actionId)).toMatchObject({
    status: "recommended",
    evidence: [
      'Page quote: "Segel lagern im Winter"',
      expect.stringContaining("2025-12: 300 estimated searches"),
    ],
  });
  expect(JSON.stringify(result)).not.toMatch(/reviewers|bbbbbbbb/);
});

it("turns a supported seasonal page update into one action that keeps its Task across repeat audits", () => {
  const input = fixture();
  const raw = legacyReport();
  const supported = {
    keyword: "canvas storage",
    audience: "sailboat owners",
    url: SEO_TEST_PAGE,
    asOf: "2026-11-01",
    country: raw.header.market.country,
    language: raw.header.market.language,
    pageQuote: "Cover your canvas before storing it.",
    event: null,
    action: "improve_existing_page",
    limitations: ["timing_uncertain"],
    comparison: null,
    windows: [
      {
        targetPeriod: "2026-12",
        historicalPeriod: "2025-12",
        historicalVolume: 95,
        baselineMedian: 10,
      },
    ],
  };
  const angle = {
    ...supported,
    keyword: "canvas repair",
    action: "investigate_angle",
  };
  const audit = (ideas: object[]) =>
    parsePublicSeoArtifact({ ...raw, seasonalReview: { insights: ideas } });
  const first = observation(
    input,
    audit([supported, angle]),
    raw.header.capturedAt,
  );
  input.observations = [first];
  const before = projectSeoProjection(input, new Date("2026-11-19T12:00:00Z"));
  const seasonal = before.actions.filter((a) => a.id.startsWith("seasonal:"));
  expect(seasonal).toEqual([
    expect.objectContaining({
      observationId: first.id,
      pageUrl: SEO_TEST_PAGE,
      status: "recommended",
      taskId: null,
    }),
  ]);
  expect(before.seasonalIdeas?.map((idea) => idea.actionId)).toEqual([
    seasonal[0].id,
    undefined,
  ]);

  const taskId = randomUUID();
  input.actionTasks = [
    {
      id: randomUUID(),
      projectId: input.project.id,
      auditId: null,
      observationId: first.id,
      actionId: seasonal[0].id,
      taskId,
      idempotencyKey: "seasonal-test",
      createdAt: now,
    },
  ];
  input.tasks = [{ id: taskId, status: "IN_PROGRESS", completedAt: null }];
  const repeat = observation(
    input,
    audit([{ ...supported, audience: "yacht owners", asOf: "2026-11-20" }]),
    "2026-11-20T12:00:00Z",
  );
  input.observations = [repeat, first];
  const after = projectSeoProjection(input, new Date("2026-11-19T12:00:00Z"));
  expect(after.actions.filter((a) => a.id.startsWith("seasonal:"))).toEqual([
    expect.objectContaining({
      id: seasonal[0].id,
      observationId: first.id,
      taskId,
      status: "task_created",
    }),
  ]);
  expect(after.seasonalIdeas?.map((idea) => idea.audience)).toEqual([
    "yacht owners",
  ]);

  input.observations = [
    observation(input, audit([]), "2026-11-21T12:00:00Z"),
    first,
  ];
  expect(
    projectSeoProjection(
      input,
      new Date("2026-11-19T12:00:00Z"),
    ).actions.filter((a) => a.taskId === taskId),
  ).toHaveLength(1);
});

it("distinguishes changing organic landing rates from a changing session mix only across complete matching cohorts", () => {
  const input = fixture();
  const long = {
    ...input.pages[0],
    id: randomUUID(),
    url: "https://example.test/read?p=7",
  };
  const short = { ...input.pages[0], url: "https://example.test/read?p=8" };
  input.pages = [short, long];
  input.scope = {
    ...input.scope,
    pages: input.pages,
    pageIds: input.pages.map((p) => p.id),
  };
  input.privateMetricsAllowed = true;
  input.query = { from: "2026-10-08", to: "2026-10-14", channel: "organic" };
  const ownerId = randomUUID();
  const source = (current: boolean) => {
    const from = current ? "2026-10-08" : "2026-10-01",
      to = current ? "2026-10-14" : "2026-10-07";
    const payload = {
      provider: "ga4",
      propertyId: "properties/42",
      pageUrls: input.pages.map((p) => p.url),
      channel: "organic",
      from,
      to,
      timeZone: "UTC",
      observedAt: now.toISOString(),
      coverage: "complete",
      notes: [],
      metrics: [],
      landingEngagementEvidence: { connectionVersion: "a".repeat(64) },
      landingPages: {
        channel: "organic",
        verifiedHost: "example.test",
        timeZone: "UTC",
        rows: [
          {
            pageUrl: short.url,
            sessions: current ? 25 : 75,
            engagementSeconds: current ? 250 : 750,
            views: current ? 50 : 75,
            keyEvents: 1,
          },
          {
            pageUrl: long.url,
            sessions: current ? 75 : 25,
            engagementSeconds: current ? 6750 : 2250,
            views: current ? 450 : 125,
            keyEvents: 2,
          },
        ],
      },
    };
    return {
      ...observation(
        input,
        parsePublicSeoArtifact(legacyReport()),
        now.toISOString(),
      ),
      kind: "metrics",
      ownerId,
      payload,
    };
  };
  const older = source(false),
    newer = source(true);
  input.observations = [newer, older];
  const change = () => projectSeoProjection(input).landingEngagementChange;
  expect(change()).toMatchObject({
    pageCount: 2,
    propertyId: "properties/42",
    before: { from: "2026-10-01", sessions: 100 },
    after: { from: "2026-10-08", sessions: 100 },
    engagementSecondsPerSession: {
      before: 30,
      after: 70,
      withinPageChange: 0,
      mixChange: 40,
    },
    viewsPerSession: { before: 2, after: 5, withinPageChange: 1, mixChange: 2 },
  });
  for (const invalid of [
    { ...older, ownerId: randomUUID() },
    {
      ...older,
      payload: {
        ...older.payload,
        landingEngagementEvidence: { connectionVersion: "b".repeat(64) },
      },
    },
    { ...older, payload: { ...older.payload, timeZone: "Europe/Oslo" } },
    { ...older, payload: { ...older.payload, propertyId: "properties/7" } },
    { ...older, payload: { ...older.payload, coverage: "partial" } },
    { ...older, payload: { ...older.payload, from: "2026-09-30" } },
    { ...older, payload: { ...older.payload, channel: "all" } },
    {
      ...older,
      payload: {
        ...older.payload,
        landingPages: { ...older.payload.landingPages, truncated: true },
      },
    },
    {
      ...older,
      payload: {
        ...older.payload,
        landingPages: {
          ...older.payload.landingPages,
          verifiedHost: "elsewhere.test",
        },
      },
    },
    {
      ...older,
      payload: {
        ...older.payload,
        landingPages: {
          ...older.payload.landingPages,
          rows: [older.payload.landingPages.rows[0]],
        },
      },
    },
    {
      ...older,
      payload: {
        ...older.payload,
        landingPages: {
          ...older.payload.landingPages,
          rows: older.payload.landingPages.rows.map((row) => ({
            ...row,
            sessions: 0,
          })),
        },
      },
    },
  ]) {
    input.observations = [newer, invalid];
    expect(change()).toBeUndefined();
  }
  input.observations = [
    {
      ...newer,
      payload: {
        ...newer.payload,
        landingEngagementEvidence: {
          ...newer.payload.landingEngagementEvidence,
          previousUnavailable: true,
        },
      },
    },
    older,
  ];
  expect(change()).toBeUndefined(); // A failed fresh check can contradict an older host inventory.
  input.observations = [newer, older];
  input.privateMetricsAllowed = false;
  expect(change()).toBeUndefined();
  expect(projectSeoProjection(input).landingPages).toBeNull();
});

it("keeps the newest landing read of each channel, so a newer AI assistant read does not replace organic key events", () => {
  const input = fixture();
  input.privateMetricsAllowed = true;
  const pageUrl = input.pages[0].url;
  const read = (channel: "organic" | "ai_assistant", at: string) => ({
    ...observation(input, parsePublicSeoArtifact(legacyReport()), at),
    kind: "metrics",
    ownerId: randomUUID(),
    payload: {
      provider: "ga4",
      propertyId: "properties/42",
      pageUrls: [pageUrl],
      channel,
      from: "2026-10-08",
      to: "2026-10-14",
      timeZone: "UTC",
      observedAt: at,
      coverage: "complete",
      notes: [],
      metrics: [],
      landingPages: {
        channel,
        verifiedHost: new URL(pageUrl).hostname,
        rows: [
          {
            pageUrl,
            sessions: 9,
            keyEvents: channel === "organic" ? 3 : 1,
          },
        ],
      },
    },
  });
  // Newest first: the AI assistant read is the newer one.
  input.observations = [
    read("ai_assistant", "2026-10-16T12:00:00.000Z"),
    read("organic", "2026-10-15T12:00:00.000Z"),
  ];
  const { landingPages, aiAssistantPages } = projectSeoProjection(input);
  expect(landingPages).toMatchObject({
    channel: "organic",
    rows: [{ keyEvents: 3 }],
    // The pages the read asked for: the reader tells a measured zero from a page outside the read.
    pageUrls: [pageUrl],
  });
  expect(aiAssistantPages).toMatchObject({
    channel: "ai_assistant",
    rows: [{ keyEvents: 1 }],
  });
  // A page URL the stored read accepts is one the workspace accepts.
  const long = `${pageUrl}${"a".repeat(2100)}`;
  expect(nativeSeoMetricsSchema.shape.pageUrls.safeParse([long]).success).toBe(
    seoWorkspaceLandingPagesSchema.shape.pageUrls.safeParse([long]).success,
  );
});

it("imports only bound public strategy decisions and links stable work to its Task across audits", () => {
  const input = fixture();
  const decision = {
    id: "task-gap",
    kind: "content_opportunity",
    targetUrl: SEO_TEST_PAGE,
    action: "Move the proven reset steps above the overview",
    reason: "The introduction delays the first step.",
    alternative: "Keep the overview if the readers need those prerequisites.",
    nextCheck:
      "Verify that the reset succeeds with the displayed instructions.",
    evidence: ["The steps start below three introductory sections."],
  };
  const raw = {
    ...legacyReport(),
    strategyDecisions: [
      decision,
      { ...decision, id: "off-scope", targetUrl: SEO_TEST_PAGE + "?other=2" },
      { ...decision, id: "secret", kind: "query_transfer" },
    ],
  };
  const payload = parsePublicSeoArtifact(raw);
  expect(payload.strategyDecisions).toEqual([decision]);
  expect(() =>
    parsePublicSeoArtifact({
      ...raw,
      privateStrategyDecisions: [{ ...decision, reason: "private terms" }],
    }),
  ).toThrow("Only public SEO evidence");
  const earlier = observation(input, payload, "2026-10-10T12:00:00Z");
  const site = parsePublicSeoArtifact({
    ...siteStrategyReport(),
    strategyDecisions: [
      { ...decision, reason: "Updated cross-page observation." },
    ],
    pages: [{ ...raw, strategyDecisions: [decision] }],
  });
  const later = observation(input, site, "2026-10-17T12:00:00Z");
  input.observations = [earlier];
  const action = projectSeoProjection(input).actions.find(
    (a) => a.title === decision.action,
  )!;
  expect(action).toMatchObject({
    kind: "opportunity",
    effort: "unknown",
    evidence: decision.evidence,
    decision: {
      kind: decision.kind,
      alternative: decision.alternative,
      nextCheck: decision.nextCheck,
    },
  });
  const taskId = randomUUID();
  input.tasks = [{ id: taskId, status: "COMPLETED", completedAt: now }];
  input.actionTasks = [
    {
      id: randomUUID(),
      taskId,
      actionId: action.id,
      observationId: earlier.id,
      createdAt: now,
      projectId: input.project.id,
      auditId: null,
      idempotencyKey: randomUUID(),
    },
  ];
  input.observations = [later, earlier];
  expect(
    projectSeoProjection(input).actions.filter((a) => a.id === action.id),
  ).toMatchObject([
    {
      taskId,
      status: "implemented",
      observationId: earlier.id,
      why: decision.reason,
    },
  ]);
  input.tasks[0]!.status = "CANCELED";
  expect(
    projectSeoProjection(input).actions.find((a) => a.id === action.id)?.status,
  ).toBe("canceled");
  input.tasks[0]!.status = "FAILED";
  expect(
    projectSeoProjection(input).actions.find((a) => a.id === action.id)?.status,
  ).toBe("failed");
  input.tasks = [];
  const hidden = projectSeoProjection(input);
  expect(hidden.actions.find((a) => a.id === action.id)).toMatchObject({
    taskId: null,
    status: "unavailable",
  });
  expect(JSON.stringify(hidden.actions)).not.toContain(taskId);
  expect(hidden.timeline.some((event) => event.taskId === taskId)).toBe(false);
  input.actionTasks = [];
  input.observations = [
    observation(
      input,
      parsePublicSeoArtifact(legacyReport()),
      "2026-10-25T12:00:00Z",
    ),
    later,
    earlier,
  ];
  expect(projectSeoProjection(input).actions.filter((a) => a.decision)).toEqual(
    [],
  );
});

function openExperimentAudit() {
  const observations = [SEO_TEST_PAGE, SEO_TEST_SECOND_PAGE].map((url, i) => ({
    url,
    snapshotId: (i ? "b" : "a").repeat(64),
    record: (i ? "d" : "c").repeat(64),
    quote: i
      ? "The lesson ends with a timed practical exercise."
      : "Each workshop opens with a practical exercise.",
  }));
  const card = {
    id: "open_strategy_opportunity:42a",
    kind: "open_strategy_opportunity",
    targetUrl: SEO_TEST_PAGE,
    action: "Test an exercise-led preview on the workshop page.",
    reason: "Both pages describe the same practical exercise.",
    alternative:
      "Keep the current introduction if readers need the theory first.",
    nextCheck:
      "Compare the number of visitors starting the practical exercise.",
    evidence: observations.map((o) => o.record),
    observations,
  };
  const pages = observations.map((o) => ({
    ...legacyReport(),
    request: { url: o.url },
    snapshotId: o.snapshotId,
  }));
  return { card, pages, observations };
}

it("projects a public cross-page experiment only when the target, quotes, records and snapshots bind to this audit", () => {
  const input = fixture();
  const { card, pages, observations } = openExperimentAudit();
  const parse = (row: unknown, reports: unknown[] = pages) =>
    parsePublicSeoArtifact({
      ...siteStrategyReport(),
      pages: reports,
      strategyDecisions: [row],
    });
  const data = parse(card);
  input.observations = [observation(input, data, "2026-10-10T12:00:00Z")];
  const action = projectSeoProjection(input).actions.find(
    (a) => a.title === card.action,
  );
  expect(action).toMatchObject({
    why: card.reason,
    kind: "opportunity",
    decision: {
      kind: card.kind,
      alternative: card.alternative,
      nextCheck: card.nextCheck,
    },
  });
  for (const o of observations) {
    expect(
      action!.evidence.some((e) => e.includes(o.quote) && e.includes(o.url)),
    ).toBe(true);
  }
  for (const invalid of [
    { ...card, evidence: [observations[1]!.record, "f".repeat(64)] },
    { ...card, observations: [observations[0], observations[0]] },
    {
      ...card,
      observations: [
        observations[0],
        { ...observations[1], quote: observations[0]!.quote },
      ],
    },
    {
      ...card,
      observations: [
        observations[0],
        { ...observations[1], snapshotId: observations[0]!.snapshotId },
      ],
    },
    {
      ...card,
      observations: [
        observations[0],
        { ...observations[1], url: "https://elsewhere.test/article" },
      ],
    },
    {
      ...card,
      observations: [
        observations[0],
        {
          ...observations[1],
          quote: "Contact person@example.test for the answer.",
        },
      ],
    },
    { ...card, observations: undefined },
    { ...card, targetUrl: SEO_TEST_SECOND_PAGE + "?token=unsafe" },
  ])
    expect(parse(invalid).strategyDecisions).toBeUndefined();
  expect(parse(card, [pages[0]!]).strategyDecisions).toBeUndefined();
  expect(
    parse(card, [
      pages[0]!,
      {
        ...pages[1],
        header: {
          ...pages[1]!.header,
          market: { country: "DE", language: "de" },
        },
      },
    ]).strategyDecisions,
  ).toBeUndefined();
  const outside = "https://elsewhere.test/article";
  expect(
    parse(
      {
        ...card,
        observations: [observations[0], { ...observations[1], url: outside }],
      },
      [pages[0], { ...pages[1], request: { url: outside } }],
    ).strategyDecisions,
  ).toBeUndefined();
  input.observations = [
    observation(
      input,
      { ...data, decisionSources: [] },
      "2026-10-10T12:00:00Z",
    ),
  ];
  expect(
    projectSeoProjection(input).actions.some((a) => a.title === card.action),
  ).toBe(false);
  expect(
    parsePublicSeoArtifact({ ...pages[0], strategyDecisions: [card] })
      .strategyDecisions,
  ).toBeUndefined();
  expect(() =>
    parse(card, [
      {
        ...pages[0]!,
        request: { ...pages[0]!.request, connections: ["search_console"] },
      },
      pages[1]!,
    ]),
  ).toThrow("Only public SEO evidence");
});

it("adds one cross-page experiment to five existing decisions in the imported workspace", () => {
  const input = fixture();
  const { card, pages } = openExperimentAudit();
  const fixed = Array.from({ length: 5 }, (_, i) => ({
    id: `content:${i}`,
    kind: "content_opportunity",
    targetUrl: card.targetUrl,
    action: `Prioritized editorial update ${i}`,
    reason: card.reason,
    alternative: card.alternative,
    nextCheck: card.nextCheck,
    evidence: ["Existing report evidence"],
  }));
  const parse = (decisions: unknown[], reports = pages) =>
    parsePublicSeoArtifact({
      ...siteStrategyReport(),
      pages: reports,
      strategyDecisions: decisions,
    });
  const data = parse([...fixed, card]);
  expect(data.strategyDecisions?.map((d) => d.action)).toEqual(
    [...fixed, card].map((d) => d.action),
  );
  input.observations = [observation(input, data, "2026-10-10T12:00:00Z")];
  expect(
    projectSeoProjection(input)
      .actions.filter((a) => a.decision)
      .map((a) => a.title)
      .sort(),
  ).toEqual([...fixed, card].map((d) => d.action).sort());
  for (const unavailable of [
    parse([...fixed, { ...card, observations: [] }]),
    parse(
      [...fixed, card],
      [
        pages[0]!,
        {
          ...pages[1]!,
          header: {
            ...pages[1]!.header,
            market: { country: "DE", language: "de" },
          },
        },
      ],
    ),
    { ...data, decisionSources: [] },
    {
      ...data,
      decisionSources: [
        {
          url: "https://example.test/account/private",
          snapshotId: "b".repeat(64),
        },
      ],
    },
    {
      ...data,
      strategyDecisions: data.strategyDecisions?.map((d) =>
        d.kind === "open_strategy_opportunity" ? { ...d, observations: [] } : d,
      ),
    },
  ]) {
    input.observations = [
      observation(input, unavailable, "2026-10-10T12:00:00Z"),
    ];
    expect(
      projectSeoProjection(input)
        .actions.filter((a) => a.decision)
        .map((a) => a.title)
        .sort(),
    ).toEqual(fixed.map((d) => d.action).sort());
  }
  for (const invalid of [
    [...fixed, { ...fixed[0], id: "extra-fixed" }],
    [...fixed, card, { ...fixed[0], id: "seventh" }],
    [card, { ...card, id: "open_strategy_opportunity:222" }],
  ])
    expect(parse(invalid).strategyDecisions).toBeUndefined();
});

it("drops contact details, identifiers and private routes from optional opportunities", () => {
  const { pages, card, observations } = openExperimentAudit();
  const parse = (row: unknown, inputs = pages) =>
    parsePublicSeoArtifact({
      ...siteStrategyReport(),
      pages: inputs,
      strategyDecisions: [row],
    }).strategyDecisions;
  for (const text of [
    "Inspect /account/guest-name/ for this change.",
    "Open //hidden.example/private/name to compare.",
    "Review ../profiles/member for an update.",
    "Read /%61ccount/alice/ for access.",
    "The service desk is +47 22 99 11 22.",
    "Contact (212) 555-0188 for the details.",
    "Use identifier 0123456789abcdef0123456789abcdef.",
    "Reference 12345678-abcd-1234-abcd-123456789abc.",
  ]) {
    expect(parse({ ...card, reason: text })).toBeUndefined();
    expect(
      parse({
        ...card,
        observations: [observations[0], { ...observations[1], quote: text }],
      }),
    ).toBeUndefined();
  }
  expect(
    parse({
      ...card,
      reason: "Check the May/June figures and the /guides page.",
    }),
  ).toHaveLength(1);
  const privatePage = "https://example.test/%61ccount/member";
  expect(
    parse(
      {
        ...card,
        observations: [
          observations[0],
          { ...observations[1], url: privatePage },
        ],
      },
      [pages[0]!, { ...pages[1]!, request: { url: privatePage } }],
    ),
  ).toBeUndefined();
});

it("binds a fresh market citation to its enclosing site, source page and provider record", () => {
  const { card, pages, observations } = openExperimentAudit();
  const snapshotId = "e".repeat(64);
  const cited = { ...observations[0], snapshotId };
  const market = {
    url: cited.url,
    pageSnapshotId: pages[0].snapshotId,
    record: cited.record,
    provider: "dataforseo",
  };
  const parse = (openMarketEvidence: unknown) =>
    parsePublicSeoArtifact({
      ...siteStrategyReport(),
      pages,
      snapshotId,
      openMarketEvidence,
      strategyDecisions: [{ ...card, observations: [cited, observations[1]] }],
    });
  const input = fixture();
  input.observations = [
    observation(input, parse(market), "2026-10-10T12:00:00Z"),
  ];
  expect(
    projectSeoProjection(input).actions.some((a) => a.title === card.action),
  ).toBe(true);
  for (const invalid of [
    undefined,
    { ...market, url: observations[1].url },
    { ...market, provider: "search-console" },
    { ...market, pageSnapshotId: snapshotId },
    { ...market, record: "f".repeat(64) },
  ]) {
    expect(parse(invalid).strategyDecisions).toBeUndefined();
  }
});

it("keeps a completed seasonal Task and reopens its recommendation after an independent local demand read, including after an unrelated audit", () => {
  const input = fixture(),
    raw = legacyReport(),
    keyword = "marine battery storage";
  const at = (day: string) => day + "T12:00:00.000Z";
  const page = (day: string, id: string) => ({
    ...raw,
    snapshotId: id.repeat(64),
    header: { ...raw.header, capturedAt: at(day) },
  });
  const original = page("2026-08-01", "a");
  const old = observation(
    input,
    parsePublicSeoArtifact({
      ...original,
      seasonalReview: {
        insights: [
          {
            keyword,
            url: SEO_TEST_PAGE,
            country: "US",
            language: "en",
            asOf: "2026-08-01",
            audience: "boat owners",
            pageQuote: "Prepare the battery before winter storage.",
            action: "improve_existing_page",
            limitations: ["timing_uncertain"],
            event: null,
            comparison: null,
            windows: [
              {
                targetPeriod: "2026-09",
                historicalPeriod: "2025-09",
                historicalVolume: 80,
                baselineMedian: 30,
              },
            ],
            demand: {
              status: "observed",
              keyword,
              months: [{ year: 2025, month: 9, search_volume: 80 }],
            },
          },
        ],
      },
    }),
    at("2026-08-01"),
  );
  input.observations = [old];
  const target = projectSeoProjection(
    input,
    new Date(at("2026-08-01")),
  ).actions.find((a) => a.id.startsWith("seasonal:"))!;
  expect(target).toBeDefined();
  const t = randomUUID();
  input.tasks = [
    { id: t, status: "COMPLETED", completedAt: new Date(at("2026-08-16")) },
  ];
  input.actionTasks = [
    {
      id: randomUUID(),
      taskId: t,
      observationId: old.id,
      actionId: target.id,
      createdAt: new Date(at("2026-08-12")),
      projectId: input.project.id,
      auditId: null,
      idempotencyKey: randomUUID(),
    },
  ];
  const monthly = (
    word: string,
    volume: number,
    when = "2026-10-05",
    hash = "b",
  ) =>
    observation(
      input,
      parsePublicSeoArtifact({
        ...page(when, hash),
        keywordData: {
          dataSource: "dataforseo",
          fetchedAt: at(when),
          facts: {
            keyword: word,
            keyword_difficulty: null,
            monthly_searches: [{ year: 2026, month: 9, search_volume: volume }],
          },
        },
      }),
      at(when),
    );
  const unrelated = observation(
    input,
    parsePublicSeoArtifact(page("2026-10-30", "c")),
    at("2026-10-30"),
  );
  const measured = monthly(keyword, 75);
  input.observations = [unrelated, measured, old];
  const observed = () =>
    projectSeoProjection(input, now).actions.filter((a) => a.id === target.id);
  expect(observed()).toMatchObject([
    {
      id: target.id,
      status: "implemented",
      taskId: t,
      observationId: old.id,
      followUpReview: {
        kind: "demand_returns",
        before: 30,
        after: 75,
        period: "2026-09",
        keyword,
        observationId: measured.id,
      },
    },
  ]);
  expect(input.tasks).toHaveLength(1);
  for (const row of [
    monthly("unrelated", 75),
    monthly(keyword, 35),
    { ...measured, scopeVersion: 2 },
    { ...measured, projectId: randomUUID() },
  ]) {
    input.observations = [unrelated, row, old];
    expect(observed()[0]?.followUpReview).toBeUndefined();
  }
  input.observations = [unrelated, measured, old];
  input.tasks[0].completedAt = new Date(at("2026-10-10"));
  expect(observed()[0]?.followUpReview).toBeUndefined();
  input.observations = [
    unrelated,
    monthly(keyword, 90, "2026-10-21", "f"),
    measured,
    old,
  ];
  expect(observed()[0]?.followUpReview).toBeUndefined();
  input.tasks = [];
  input.actionTasks = [];
  expect(observed()).toMatchObject([
    {
      status: "needs_review",
      followUpReview: { observationId: measured.id, after: 75 },
    },
  ]);
});

it("ties a recent publication group to the page records and filters older context by the selected scope", () => {
  const input = fixture(),
    raw = legacyReport(),
    topic = "Section A";
  function child(n: number, day: string) {
    return {
      ...raw,
      request: { url: "https://example.test/%C3%A9nergie-marine-" + n },
      articleDates: {
        publishedOn: day,
        section: topic,
        record: String(n).repeat(64),
      },
    };
  }
  const children = [
    child(1, "2026-10-01"),
    child(2, "2026-10-02"),
    child(3, "2025-04-03"),
  ];
  const pages = children.map((c) => ({
    url: c.request.url,
    publishedOn: c.articleDates.publishedOn,
    record: c.articleDates.record,
  }));
  const group = {
    topic,
    publishedFrom: "2026-10-01",
    publishedThrough: "2026-10-02",
    pages: pages.slice(0, 2),
    earlierArticle: pages[2],
  };
  const site = {
    ...siteStrategyReport(),
    pages: children,
    request: { url: pages[0].url },
    selection: { pages: pages.map((p) => ({ url: p.url, source: "links" })) },
    topicLaunches: [group],
  };
  const data = parsePublicSeoArtifact(site);
  expect(data.topicLaunches).toEqual([group]);
  // French headline phrases are public only when every dated page and its public source corroborate the label.
  const phrase = "Énergie marine";
  const unlabeled = children.map((c, i) => ({
    ...c,
    articleDates: {
      ...c.articleDates,
      section: "News",
      headline:
        phrase +
        ": " +
        [
          "Entretien des turbines",
          "Installation du capteur",
          "Guide des moteurs",
        ][i],
    },
  }));
  const inferred = { ...group, topic: phrase, basis: "headline_phrase" };
  const inferredSite = {
    ...site,
    pages: unlabeled,
    topicLaunches: [inferred],
  };
  expect(parsePublicSeoArtifact(inferredSite).topicLaunches).toEqual([
    inferred,
  ]);
  expect(() =>
    parsePublicSeoArtifact({
      ...inferredSite,
      privateTopicQueries: [{ query: "private supplied query" }],
    }),
  ).toThrow(/Only public SEO evidence/);
  for (const change of [
    { headline: "A different heading" },
    { section: "Publisher topic" },
    { headline: unlabeled[0].articleDates.headline },
  ]) {
    const replaced = unlabeled.map((c, i) =>
      i === 1 ? { ...c, articleDates: { ...c.articleDates, ...change } } : c,
    );
    expect(
      parsePublicSeoArtifact({ ...inferredSite, pages: replaced })
        .topicLaunches,
    ).toBeUndefined();
  }
  const privateSelection = parsePublicSeoArtifact({
    ...site,
    selection: {
      pages: pages.map((p, i) => ({
        url: p.url,
        source: i === 1 ? "search-console" : "links",
      })),
    },
  });
  expect(privateSelection.articleDates?.map((a) => a.url)).not.toContain(
    pages[1].url,
  );
  expect(privateSelection.topicLaunches).toBeUndefined();
  expect(
    parsePublicSeoArtifact({
      ...site,
      topicLaunches: [
        {
          ...group,
          earlierArticle: { ...group.earlierArticle, record: "a".repeat(64) },
        },
      ],
    }).topicLaunches,
  ).toBeUndefined();
  const selected = pages
    .slice(0, 2)
    .map((p) => ({ ...input.pages[0], id: randomUUID(), url: p.url }));
  input.pages = selected;
  input.scope = {
    ...input.scope,
    pages: selected,
    pageIds: selected.map((p) => p.id),
  };
  input.observations = [observation(input, data, now.toISOString())];
  const projected = projectSeoProjection(input, now);
  expect(projected.topicLaunches?.[0]).toMatchObject({
    topic,
    pages: pages.slice(0, 2),
  });
  expect(projected.topicLaunches?.[0]?.earlierArticle).toBeUndefined();
  expect(projected.articleDates?.map((a) => a.url)).toEqual(
    selected.map((p) => p.url),
  );
});

it("binds sibling site ranking triggers to their exact audited page and preserves the measured review on its original Task", () => {
  const input = fixture(),
    raw = legacyReport(),
    word = "camera repair";
  function reportFor(day: string, position: number, hash: string, term = word) {
    const at = day + "T12:00:00.000Z",
      snapshotId = hash.repeat(64);
    const page = {
      ...raw,
      snapshotId,
      header: { ...raw.header, capturedAt: at },
      rankingData: {
        ...raw.rankingData,
        source: "DataForSEO Labs and Backlinks API",
        page: {
          ...raw.rankingData.page,
          rankedResult: "ok",
          ranked: {
            rows: [
              {
                url: SEO_TEST_PAGE,
                keyword: term,
                position,
                intent: null,
                volume: 100,
              },
            ],
          },
        },
      },
    };
    const decision = {
      id: "ranked.camera",
      kind: "content_opportunity",
      targetUrl: SEO_TEST_PAGE,
      action: "Check which repair questions the page answers.",
      reason: "The page ranks close to the first ten.",
      alternative: "Keep the page if it already answers the query.",
      nextCheck: "Check the next observed rank.",
      evidence: [snapshotId, "rankingData.page.ranked"],
    };
    const earlier = hash === "a";
    const site = {
      ...siteStrategyReport(),
      pages: [page],
      strategyDecisions: earlier ? [decision] : [],
      rankReviewTriggers: earlier
        ? [
            {
              decisionId: decision.id,
              kind: "rank_crosses",
              keyword: term,
              position,
              boundary: 10,
            },
          ]
        : [],
    };
    return observation(input, parsePublicSeoArtifact(site), at);
  }
  const old = reportFor("2026-09-01", 12, "a"),
    better = reportFor("2026-10-06", 8, "b"),
    unrelated = reportFor("2026-10-30", 3, "c", "other");
  input.observations = [old];
  const id = projectSeoProjection(input, now).actions.find(
    (a) => a.decision,
  )?.id;
  expect(id).toBeDefined();
  const taskId = randomUUID(),
    completedAt = new Date("2026-09-10T00:00:00Z");
  input.tasks = [{ id: taskId, status: "COMPLETED", completedAt }];
  input.actionTasks = [
    {
      id: randomUUID(),
      taskId,
      actionId: id!,
      observationId: old.id,
      createdAt: completedAt,
      projectId: input.project.id,
      auditId: null,
      idempotencyKey: randomUUID(),
    },
  ];
  input.observations = [unrelated, better, old];
  input.query = { from: "2026-10-01", to: "2026-10-31" };
  const result = () =>
    projectSeoProjection(input, now).actions.filter((a) => a.id === id);
  expect(result()).toMatchObject([
    {
      taskId,
      status: "implemented",
      observationId: old.id,
      followUpReview: {
        kind: "rank_crosses",
        before: 12,
        after: 8,
        keyword: word,
        observationId: better.id,
      },
    },
  ]);
  expect(result()).toHaveLength(1);
  input.observations = [reportFor("2026-10-30", 14, "d"), better, old];
  expect(result()[0]?.followUpReview).toBeUndefined();
  const again = reportFor("2026-10-30", 7, "e");
  input.tasks[0]!.completedAt = new Date("2026-10-10T12:00:00Z");
  input.observations = [again, better, old];
  expect(result()[0]?.followUpReview).toBeUndefined();
  input.query.from = "2026-10-20";
  expect(result()[0]?.followUpReview).toBeUndefined();
  const reversal = reportFor("2026-10-15", 14, "f");
  input.observations = [again, reversal, better, old];
  expect(result()).toMatchObject([
    {
      status: "implemented",
      followUpReview: { observationId: again.id, after: 7 },
    },
  ]);
  input.tasks[0]!.completedAt = completedAt;
  expect(input.tasks[0]).toEqual({
    id: taskId,
    status: "COMPLETED",
    completedAt,
  });
});

it("imports one page's additional experiment only with its separate public page and market receipts", () => {
  const { card, observations, pages } = openExperimentAudit();
  const page = pages[0]!;
  const source = observations.map((o, i) => ({
    ...o,
    url: page.request.url,
    snapshotId: page.snapshotId,
    sourceKind: i ? "market" : "page",
  }));
  const evidence = {
    url: page.request.url,
    snapshotId: page.snapshotId,
    records: source.map(({ record, sourceKind }) => ({ record, sourceKind })),
  };
  const parse = (index: unknown, proof: unknown = source) =>
    parsePublicSeoArtifact({
      ...page,
      openPageEvidence: index,
      strategyDecisions: [{ ...card, observations: proof }],
    });
  const data = parse(evidence);
  expect(data.strategyDecisions).toHaveLength(1);
  const input = fixture();
  input.observations = [observation(input, data, data.observedAt)];
  const action = projectSeoProjection(input).actions.find(
    (a) => a.title === card.action,
  );
  expect(action?.evidence).toHaveLength(2);
  expect(action?.evidence[0]).toContain("Page");
  expect(action?.evidence[1]).toContain("Market");
  expect(parse(undefined).strategyDecisions).toBeUndefined();
  expect(
    parse({ ...evidence, snapshotId: "f".repeat(64) }).strategyDecisions,
  ).toBeUndefined();
  expect(
    parse({
      ...evidence,
      records: evidence.records.map((r) => ({ ...r, sourceKind: "page" })),
    }).strategyDecisions,
  ).toBeUndefined();
  expect(
    parse(
      evidence,
      source.map((s) => ({ ...s, record: source[0]!.record })),
    ).strategyDecisions,
  ).toBeUndefined();
});

describe("scoped checklist and research coverage", () => {
  it("counts only the selected page, preserves blocked rows in the denominator and binds duplicate row ids to their own page", () => {
    const input = fixture();
    const run = (url: string, result: string, reason: string) => ({
      ...legacyReport(),
      request: { url },
      checklist: [
        { row: "SPEED", device: "mobile", result },
        { row: "STRUCT", device: "mobile", result: "pass" },
      ],
      couldNotSee: [{ item: "SPEED on mobile", reason }],
    });
    const payload = parsePublicSeoArtifact({
      ...siteStrategyReport(),
      explorationStatus: { status: "ran", reason: "published" },
      pages: [
        run(SEO_TEST_PAGE, "blocked", "Renderer unavailable"),
        run(SEO_TEST_SECOND_PAGE, "not checked", "Second page only"),
      ],
    });
    input.observations = [observation(input, payload, now.toISOString())];
    const { observations, timeline } = projectSeoProjection(input);
    expect(observations[0].coverage).toEqual({
      checked: 1,
      skipped: 0,
      failed: 1,
    });
    expect(timeline[0].detail).toContain(
      "1 checked, 0 not checked, 1 unavailable",
    );
    const details = observations[0].checklistBreakdown;
    expect(details).toMatchObject({
      passed: 1,
      flagged: 0,
      gaps: [
        { rowId: "SPEED", device: "mobile", reason: "Renderer unavailable" },
      ],
    });
    expect(
      details?.research.every(
        (r) => r.scope === "page" && r.pageUrl === SEO_TEST_PAGE,
      ),
    ).toBe(true);
    expect(JSON.stringify(details)).not.toContain("Second page only");
  });

  it("keeps research while marking the split unknown for an audit with aggregate counts only", () => {
    const input = fixture();
    const payload = parsePublicSeoArtifact(legacyReport());
    payload.checks = [];
    payload.coverage = { checked: 4, skipped: 2, failed: 0 };
    delete payload.researchCoverage;
    input.observations = [observation(input, payload, now.toISOString())];
    const row = projectSeoProjection(input).observations[0];
    expect(row.coverage).toEqual(payload.coverage);
    expect(row.checklistBreakdown).toMatchObject({
      passed: null,
      flagged: null,
      gaps: [],
    });
    expect(row.checklistBreakdown?.research.length).toBeGreaterThan(0);
    payload.pageUrls.push(SEO_TEST_SECOND_PAGE);
    input.observations = [observation(input, payload, now.toISOString())];
    const scoped = projectSeoProjection(input).observations[0];
    expect(scoped.coverage.checked).toBe(0);
    expect(scoped.checklistBreakdown).toMatchObject({
      passed: null,
      flagged: null,
    });
  });

  it("recovers historical page notes and reports retained research evidence without guessing absent stages", () => {
    const input = fixture();
    const legacy = parsePublicSeoArtifact({
      ...legacyReport(),
      checklist: [{ row: "SPEED", device: "mobile", result: "not checked" }],
      couldNotSee: [{ item: "SPEED on mobile", reason: "Old render timeout" }],
    });
    delete legacy.researchCoverage;
    delete legacy.checks[0].reason;
    input.observations = [observation(input, legacy, now.toISOString())];
    const details =
      projectSeoProjection(input).observations[0].checklistBreakdown;
    expect(details?.gaps[0].reason).toBe("Old render timeout");
    expect(details?.research[0].stages.map((s) => s.status)).toEqual([
      "unknown",
      "unknown",
      "unknown",
    ]);
  });
  it("shows interrupted exploration as partial and honors explicit historical copy-withheld evidence", () => {
    const input = fixture();
    const payload = parsePublicSeoArtifact({
      ...legacyReport(),
      explorationStatus: { status: "ran", reason: "deadline" },
    });
    input.observations = [observation(input, payload, now.toISOString())];
    expect(
      projectSeoProjection(input).observations[0].checklistBreakdown
        ?.research[0].stages,
    ).toContainEqual({
      name: "exploration",
      status: "partial",
      reason: "The audit reached its time limit.",
    });
    delete payload.researchCoverage;
    payload.notes = [
      "Seasonal keyword research: The captured page could not be used as public evidence for seasonal keyword research.",
    ];
    payload.keywords[0].editorial = {
      models: ["gemini"],
      record: "a".repeat(64),
    };
    expect(
      projectSeoProjection(input).observations[0].checklistBreakdown
        ?.research[0].stages,
    ).toEqual([
      expect.objectContaining({ name: "seasonal", status: "skipped" }),
      expect.objectContaining({
        name: "editorial",
        status: "unknown",
        reason: expect.stringContaining("keyword research"),
      }),
      { name: "exploration", status: "unknown" },
    ]);
  });
});

it("retains an empty ranked idea list only for the selected audit page", () => {
  const input = fixture();
  const page = legacyReport();
  const empty = {
    ...page,
    rankingData: { ...page.rankingData, gaps: [] },
    keywordOpportunities: {
      list: [],
      editorialResearch: {
        status: "complete",
        proposed: 0,
        checked: 0,
        qualified: 0,
      },
    },
  };
  for (const selected of [true, false]) {
    const site = {
      ...siteStrategyReport(),
      pages: [
        {
          ...empty,
          request: { url: selected ? SEO_TEST_PAGE : SEO_TEST_SECOND_PAGE },
        },
        {
          ...page,
          request: { url: selected ? SEO_TEST_SECOND_PAGE : SEO_TEST_PAGE },
        },
      ],
    };
    input.observations = [
      observation(input, parsePublicSeoArtifact(site), now.toISOString()),
    ];
    const workspace = projectSeoProjection(input);
    const marker = workspace.observations[0].checklistBreakdown?.research.some(
      (record) => record.rankedKeywordIdeas,
    );
    expect(marker).toBe(selected);
  }
});

it("shows only verified same-site regional versions for the standalone audited page", () => {
  const input = fixture();
  const page = legacyReport();
  const verified = {
    country: "CH",
    language: "de",
    url: "https://www.example.test/de-ch",
  };
  const report = {
    ...page,
    header: {
      ...page.header,
      finalUrl: { desktop: "https://www.example.test/page" },
    },
    pageMarketEvidence: {
      comparisonNote:
        "This page audit did not measure competitor visibility by country and language.",
      regionalVersions: [
        verified,
        { ...verified, url: "https://other.test/page" },
        { ...verified, url: "https://www.example.test/private/area" },
      ],
    },
  };
  const read = (raw: unknown) => {
    input.observations = [
      observation(input, parsePublicSeoArtifact(raw), now.toISOString()),
    ];
    return projectSeoProjection(input).observations[0];
  };
  expect(read(report).pageMarketEvidence).toEqual({
    regionalVersions: [verified],
  });
  expect(read(page).pageMarketEvidence).toBeUndefined();
  expect(
    read({ ...siteStrategyReport(), pages: [report, page] }).pageMarketEvidence,
  ).toBeUndefined();
});

it("returns site market evidence only for a scope covering the audited pages", () => {
  const input = fixture();
  const second = {
    ...input.pages[0],
    url: SEO_TEST_SECOND_PAGE,
    id: randomUUID(),
  };
  const pages = [...input.pages, second];
  const scope = { ...input.scope, pages, pageIds: pages.map((p) => p.id) };
  const base = siteStrategyReport();
  const report = legacyReport();
  const payload = parsePublicSeoArtifact({
    ...base,
    pages: [report, { ...report, request: { url: second.url } }],
    strategy: {
      ...base.strategy,
      markets: undefined,
      marketNote: "the start page's Run found no Market",
    },
  });
  const row = observation({ ...input, scope }, payload, now.toISOString());
  const read = (selection: Input["scope"], stored = row) =>
    projectSeoProjection({
      ...input,
      pages,
      scope: selection,
      observations: [stored],
    }).strategy;
  expect(read(scope)?.marketNote).toBe("missing_baseline");
  expect(read(input.scope)?.marketNote).toBeUndefined();
  expect(
    read(scope, {
      ...row,
      payload: {
        ...payload,
        strategy: {
          ...payload.strategy,
          marketNote: "invalid",
          markets: { rows: "broken" },
        },
      },
    }),
  ).toMatchObject({ verdict: base.strategy.verdict });
});

it("projects an unknown visitor check and each Google Trends row, excluding unknown child fields", () => {
  const current = fixture();
  const firstScreen = {
    probe: "desktop_first_screen",
    label: "Download for macOS",
    state: "unknown",
    reason: "The saved viewport did not show the control.",
    record: "a".repeat(64),
  };
  const row = {
    keyword: "macbook battery health",
    peakMonths: ["April", "March", "May"],
    seasonal: true,
    trend: "falling",
    change: 0.39,
    status: "read",
    note: "Relative interest.",
  };
  const failed = {
    ...row,
    keyword: "Akku prüfen",
    status: "failed",
    peakMonths: [],
    seasonal: null,
    trend: "not determined",
    change: null,
    note: "private-provider-sentinel",
  };
  const base = legacyReport();
  const report = parsePublicSeoArtifact({
    ...base,
    strategyInvestigation: { ...firstScreen, extra: "drop" },
    trends: {
      keywords: [{ ...row, extra: "drop" }, failed],
      note: "Relative interest.",
    },
  });
  expect(JSON.stringify(report)).not.toContain("private-provider-sentinel");
  // Previously imported reports can still contain the provider detail on disk.
  const retained = structuredClone(report);
  retained.researchCoverage![0]!.trends!.keywords[1]!.note = failed.note;
  retained.researchCoverage![0]!.trends!.note =
    "Context only. Values are relative, 0 to 100, within one request (Google Trends help).";
  current.observations.push(observation(current, retained, now.toISOString()));
  const [research] =
    projectSeoProjection(current).observations[0]!.checklistBreakdown!.research;
  expect(research?.trends?.note).toBe(
    "For each term, 100 marks its peak search interest in this period.",
  );
  expect(research?.trends?.keywords).toEqual([
    row,
    {
      ...failed,
      note: "Google Trends returned no usable data.",
    },
  ]);
  expect(research?.firstScreen).toEqual(firstScreen);
  expect(
    parsePublicSeoArtifact({
      ...base,
      strategyInvestigation: { ...firstScreen, record: "unbound" },
    }).researchCoverage?.[0]?.firstScreen,
  ).toBeUndefined();
  expect(() =>
    parsePublicSeoArtifact({
      ...base,
      searchConsole: {},
      strategyInvestigation: firstScreen,
    }),
  ).toThrow();
});

it("keeps the original recommendation with each report even when the current worklist supersedes it", () => {
  const input = fixture();
  const first = parsePublicSeoArtifact(legacyReport());
  const second = structuredClone(first);
  expect(first.actions.length).toBeGreaterThan(0);
  first.actions[0]!.title = "Repair the earlier page title";
  second.actions[0]!.title = "Clarify the new page title";
  const old = observation(input, first, "2026-10-01T12:00:00Z");
  const latest = observation(input, second, "2026-11-01T12:00:00Z");
  input.observations = [latest, old];
  const reports = projectSeoProjection(input, now).observations;
  expect(
    reports.map((report) => report.planCandidates?.map((item) => item.title)),
  ).toEqual([
    expect.arrayContaining(["Clarify the new page title"]),
    expect.arrayContaining(["Repair the earlier page title"]),
  ]);
});

it("connects a recorded 404 to the selected destination even when the finding has no repair action", () => {
  const input = fixture();
  const payload = parsePublicSeoArtifact(legacyReport());
  const target = {
    ...input.pages[0]!,
    id: randomUUID(),
    url: SEO_TEST_SECOND_PAGE,
  };
  input.pages.push(target);
  input.scope.pages.push(target);
  input.scope.pageIds.push(target.id);
  payload.pageUrls = [SEO_TEST_PAGE, SEO_TEST_SECOND_PAGE];
  payload.findings = [
    {
      ...payload.findings[0]!,
      id: "broken",
      rowId: "IL-04",
      pageUrl: SEO_TEST_PAGE,
      severity: "note",
      title: "Links reach live pages",
      evidence: [
        SEO_TEST_SECOND_PAGE + " → 404",
        "https://outside.example/checkout → 404",
      ],
    },
  ];
  payload.actions = [];
  input.observations = [observation(input, payload, "2026-10-01T12:00:00Z")];
  const projected = () =>
    projectSeoProjection(input, now).observations[0]?.planCandidates ?? [];
  expect(projected()).toContainEqual(
    expect.objectContaining({
      kind: "broken_link",
      pageUrl: SEO_TEST_PAGE,
      destinations: [SEO_TEST_SECOND_PAGE],
      evidence: [SEO_TEST_SECOND_PAGE + " → 404"],
    }),
  );
  input.scope.pages = [input.pages[0]!];
  input.scope.pageIds = [input.pages[0]!.id];
  expect(projected().some((item) => item.kind === "broken_link")).toBe(false);
});

it("keeps every distinct repair and describes the observed slash redirect in its direction", () => {
  const input = fixture();
  const payload = parsePublicSeoArtifact(legacyReport());
  const entry = "https://example.com/de/";
  const destination = "https://example.com/de";
  payload.findings = [
    {
      ...payload.findings[0]!,
      id: "languages",
      rowId: "IN-07",
      pageUrl: SEO_TEST_PAGE,
      evidence: [
        `${entry} redirects to the en homepage https://example.com/; its declared de destination ${destination} returns HTTP 200 in de.`,
      ],
    },
  ];
  payload.actions = [
    "Fix locale routing",
    "Update language links",
    "Check fallback routing",
  ].map((title, i) => ({
    ...payload.actions[0]!,
    id: `repair-${i}`,
    pageUrl: SEO_TEST_PAGE,
    findingIds: ["languages"],
    title,
  }));
  input.observations = [observation(input, payload, "2026-10-01T12:00:00Z")];
  const rows = projectSeoProjection(input, now).observations[0]!
    .planCandidates!;
  expect(rows.filter((r) => r.kind === "repair")).toHaveLength(3);
  expect(rows).toContainEqual(
    expect.objectContaining({
      kind: "experiment",
      pageUrl: SEO_TEST_PAGE,
      queries: ["gap term"],
      evidence: [expect.stringContaining("30 monthly searches")],
    }),
  );
  expect(rows.find((r) => r.actionId === "repair-0")?.reason).toContain(
    "Send them to /de, which already serves the correct language.",
  );
});

it("shows the worker's audit plan with a step that names an action of the same report", () => {
  const input = fixture();
  const payload = parsePublicSeoArtifact(legacyReport());
  payload.plan = {
    summary: "The audit found one issue.",
    steps: [
      {
        pageUrl: SEO_TEST_PAGE,
        action: "Add a title",
        why: "The page has no title.",
        nextCheck: "The next audit reads a title.",
        actionIds: [payload.actions[0]!.id],
      },
    ],
  };
  const report = observation(input, payload, "2026-11-01T12:00:00Z");
  input.observations = [report];
  const workspace = projectSeoProjection(input, now);
  const [actionId] = workspace.observations[0]!.auditPlan!.steps[0]!.actionIds;
  expect(
    workspace.actions.filter(
      (action) => action.observationId === report.id && action.id === actionId,
    ),
  ).toHaveLength(1);
});
