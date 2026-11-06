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
    pass.payload = parsePublicSeoArtifact(focusedReport());
    pass.observedAt = new Date("2026-11-02T11:00:00Z");
    expect(projectSeoProjection(input).actions[0].status).toBe("implemented");
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
