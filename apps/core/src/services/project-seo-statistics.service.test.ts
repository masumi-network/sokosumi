import {
  SEO_STATISTICS_KEYWORD_SERIES_UNAVAILABLE_NOTE,
  seoStatisticsLostData,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const pageId = "22222222-2222-4222-8222-222222222222";
  const scopeId = "33333333-3333-4333-8333-333333333333";
  const at = new Date("2026-01-03T00:00:00Z");
  return {
    projectId,
    pageId,
    scopeId,
    at,
    member: true,
    closing: false,
    integrationActive: true,
    pageUrl: "https://example.test/a",
    observations: [] as Array<Record<string, unknown>>,
    keywords: [] as Array<Record<string, unknown>>,
    reads: [] as Array<{ slug: string; args: Record<string, unknown> }>,
    answer: undefined as
      | ((slug: string, args: Record<string, unknown>) => unknown)
      | undefined,
  };
});
vi.mock("@/lib/db/prisma", () => {
  const page = {
    id: state.pageId,
    projectId: state.projectId,
    url: "https://example.test/a",
    label: "",
    relationship: "primary",
    relatedToPageId: null,
    createdAt: state.at,
    updatedAt: state.at,
  };
  const scope = {
    id: state.scopeId,
    projectId: state.projectId,
    name: "Pages",
    version: 2,
    pageIds: [state.pageId],
    createdAt: state.at,
    updatedAt: state.at,
  };
  const db = {
    workspace: {
      findFirst: async () => (state.member ? { id: "workspace" } : null),
    },
    project: {
      findFirst: async () => ({
        id: state.projectId,
        websiteUrl: null,
        closingAt: state.closing ? state.at : null,
        closedAt: null,
      }),
    },
    sokoBot: { findFirst: async () => ({ id: "personal-bot" }) },
    seoConnection: { findUnique: async () => null },
    sokoBotIntegration: {
      findMany: async () =>
        state.integrationActive
          ? [{ composioAccountId: "account", sokoBotId: "personal-bot" }]
          : [],
    },
    projectSeoPage: { findMany: async () => [{ ...page, url: state.pageUrl }] },
    projectSeoScope: {
      findFirst: async () => scope,
      findMany: async () => [scope],
    },
    projectSeoObservation: {
      findMany: async () => state.observations,
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const saved = {
          id: "44444444-4444-4444-8444-444444444444",
          createdAt: state.at,
          sourceTaskId: null,
          sourceFileId: null,
          ...create,
        };
        state.observations.push(saved);
        return saved;
      },
    },
    projectSeoKeyword: { findMany: async () => state.keywords },
    projectSeoCompetitor: { findMany: async () => [] },
    projectSeoAnalysis: { findMany: async () => [] },
    projectSeoActionTask: { findMany: async () => [] },
    taskSchedule: { findMany: async () => [] },
    $queryRaw: async (_query: TemplateStringsArray, id: string) => [{ id }],
    $transaction: async (work: (tx: unknown) => unknown) => work(db),
  };
  return { default: db };
});
vi.mock(
  "@/services/composio-integration-tools.service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/services/composio-integration-tools.service")
    >()),
    listIntegrationTools: async () => [
      {
        slug: "GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES",
        readOnly: true,
        inputSchema: { properties: { pageSize: {}, pageToken: {} } },
      },
      {
        slug: "GOOGLE_ANALYTICS_RUN_REPORT",
        readOnly: true,
        inputSchema: {
          properties: {
            property: {},
            dateRanges: {},
            dimensions: {},
            metrics: {},
            dimensionFilter: {},
            limit: { type: "integer" },
            returnPropertyQuota: {},
          },
          required: ["property"],
        },
      },
      {
        slug: "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
        readOnly: true,
        inputSchema: { properties: {} },
      },
      {
        slug: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
        readOnly: true,
        inputSchema: {
          properties: {
            site_url: {},
            start_date: {},
            end_date: {},
            dimensions: {},
            search_type: {},
            data_state: {},
            dimension_filter_groups: {},
            row_limit: {},
            start_row: {},
          },
          required: ["site_url", "start_date", "end_date"],
        },
      },
    ],
    readIntegrationTool: async (
      _integration: unknown,
      slug: string,
      args: Record<string, unknown>,
    ) => {
      state.reads.push({ slug, args });
      return state.answer!(slug, args);
    },
  }),
);

import { runSeoTool } from "@/lib/soko-bot/seo-tools";
import { syncProjectSeoStatistics } from "./project-seo-statistics.service";

const actor = {
  owner: { kind: "project" as const, id: state.projectId },
  workspaceId: "workspace",
  organizationId: null,
  userId: "owner",
  sokoBotId: "personal-bot",
  privateMetricsAllowed: true,
};
const input = {
  provider: "ga4" as const,
  propertyId: "properties/123",
  from: "2026-01-01",
  to: "2026-01-02",
  channel: "all" as const,
};
function ga4(daily: boolean) {
  return {
    dimensionHeaders: daily ? [{ name: "date" }] : [],
    metricHeaders: [
      "screenPageViews",
      "activeUsers",
      "sessions",
      "userEngagementDuration",
    ].map((name) => ({ name })),
    rows: [
      {
        dimensionValues: daily ? [{ value: "20260101" }] : [],
        metricValues: ["6", "3", "4", "10"].map((value) => ({ value })),
      },
    ],
    metadata: { timeZone: "Europe/Oslo" },
  };
}
function answer(slug: string, args: Record<string, unknown>) {
  const data = slug.endsWith("SUMMARIES")
    ? {
        accountSummaries: [
          { propertySummaries: [{ property: "properties/123" }] },
        ],
      }
    : ga4(Array.isArray(args.dimensions) && args.dimensions.length > 0);
  return { successful: true, data: JSON.stringify(data) };
}
beforeEach(() => {
  state.member = true;
  state.closing = false;
  state.pageUrl = "https://example.test/a";
  state.integrationActive = true;
  state.observations.length = 0;
  state.keywords.length = 0;
  state.reads.length = 0;
  state.answer = answer;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected live network call");
    }),
  );
});

describe("native statistics collection boundary", () => {
  it("stores measured owner-only observations through the existing native connection", async () => {
    await syncProjectSeoStatistics(actor, input);
    expect(state.observations).toHaveLength(1);
    expect(state.observations[0]).toMatchObject({
      ownerId: "owner",
      source: "ga4",
      pageIds: [state.pageId],
    });
    expect(state.reads).toHaveLength(3);
    expect(state.reads[1].args.limit).toBe(400);
  });
  it("rejects a changed page-group version before any toolkit read", async () => {
    await expect(
      syncProjectSeoStatistics(actor, {
        ...input,
        scopeId: state.scopeId,
        expectedScopeVersion: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.reads).toHaveLength(0);
  });
  it("refuses collection for a closing Project before any native query", async () => {
    state.closing = true;
    await expect(syncProjectSeoStatistics(actor, input)).rejects.toMatchObject({
      status: 409,
    });
    expect(state.reads).toHaveLength(0);
  });
  it("does not treat a host with the same prefix as a covered Search Console property", async () => {
    state.pageUrl = "https://example.test.evil/a";
    state.answer = () => ({
      siteEntry: [
        { siteUrl: "https://example.test", permissionLevel: "siteOwner" },
      ],
    });
    await expect(
      syncProjectSeoStatistics(actor, {
        ...input,
        provider: "search_console",
        propertyId: "https://example.test",
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(state.reads.map((read) => read.slug)).toEqual([
      "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
    ]);
  });
  it("retains successful totals when the daily native payload reports failure", async () => {
    state.answer = (slug, args) =>
      Array.isArray(args.dimensions) && args.dimensions.length
        ? { successful: false, error: "provider failed", data: ga4(true) }
        : answer(slug, args);
    await syncProjectSeoStatistics(actor, input);
    expect(state.observations[0].payload).toMatchObject({
      coverage: "partial",
      metrics: [
        { value: 6, points: [] },
        { value: 3, points: [] },
        { value: 4, points: [] },
        { value: 10, points: [] },
      ],
    });
  });
  it("reauthorizes membership after provider reads and refuses retention after removal", async () => {
    state.answer = (slug, args) => {
      const data = answer(slug, args);
      if (slug.endsWith("RUN_REPORT")) state.member = false;
      return data;
    };
    await expect(syncProjectSeoStatistics(actor, input)).rejects.toMatchObject({
      status: 404,
    });
    expect(state.observations).toHaveLength(0);
  });
  it("refuses shared-bot statistics before provider reads and reauthorizes a completed-call replay", async () => {
    await expect(
      syncProjectSeoStatistics(
        { ...actor, privateMetricsAllowed: false },
        input,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(state.reads).toHaveLength(0);
    state.member = false;
    await expect(
      runSeoTool(
        "sync_seo_statistics",
        { projectId: state.projectId, ...input },
        actor,
        {},
        true,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(state.reads).toHaveLength(0);
  });
});

describe("Search Console query rows", () => {
  const gscInput = {
    provider: "search_console" as const,
    propertyId: "sc-domain:example.test",
    from: "2026-01-01",
    to: "2026-01-02",
    channel: "organic" as const,
  };
  const metric = { clicks: 1, impressions: 9, ctr: 0.11, position: 4.2 };
  function gsc(queryRows: unknown, seriesRows: unknown = { rows: [] }) {
    return (slug: string, args: Record<string, unknown>) => {
      if (slug.endsWith("LIST_SITES"))
        return {
          siteEntry: [
            { siteUrl: "sc-domain:example.test", permissionLevel: "siteOwner" },
          ],
        };
      const dimensions = args.dimensions as string[];
      if (dimensions.join() === "date,query") return seriesRows;
      if (dimensions.includes("query")) return queryRows;
      return {
        rows: dimensions.length
          ? [{ keys: ["2026-01-01"], ...metric }]
          : [{ keys: [], ...metric }],
      };
    };
  }

  it("stores query/page rows from the same page-filtered read", async () => {
    state.answer = gsc({
      rows: [{ keys: ["battery", state.pageUrl], ...metric }],
    });
    await syncProjectSeoStatistics(actor, gscInput);
    const queryRead = state.reads.find((read) =>
      ((read.args.dimensions ?? []) as string[]).includes("query"),
    );
    expect(queryRead?.args.dimensions).toEqual(["query", "page"]);
    expect(state.observations[0].payload).toMatchObject({
      queries: {
        truncated: false,
        rows: [
          {
            query: "battery",
            pageUrl: state.pageUrl,
            impressions: 9,
            averagePosition: 4.2,
          },
        ],
      },
    });
  });

  it("keeps totals and says so when the query read leaves the selection", async () => {
    state.answer = gsc({
      rows: [{ keys: ["battery", "https://example.test/other"], ...metric }],
    });
    await syncProjectSeoStatistics(actor, gscInput);
    const payload = state.observations[0].payload as {
      queries?: unknown;
      notes: string[];
      metrics: Array<{ value: number | null }>;
    };
    expect(payload.queries).toBeUndefined();
    expect(payload.metrics[0].value).toBe(1);
    expect(payload.notes.join(" ")).toContain("query rows were unavailable");
  });

  const seriesRead = () =>
    state.reads.filter(
      (read) =>
        (read.args.dimensions as string[] | undefined)?.join() === "date,query",
    );
  const saved = (keyword: string, priority = "medium") => ({
    id: `55555555-5555-4555-8555-${String(state.keywords.length).padStart(12, "0")}`,
    keyword,
    keywordKey: keyword.toLowerCase(),
    countryCode: "US",
    languageCode: "en",
    pageId: null,
    priority,
    saved: true,
    version: 1,
    updatedAt: state.at,
  });

  it("makes no keyword read and stores no series without tracked keywords", async () => {
    state.answer = gsc({
      rows: [{ keys: ["battery", state.pageUrl], ...metric }],
    });
    await syncProjectSeoStatistics(actor, gscInput);
    expect(seriesRead()).toHaveLength(0);
    const payload = state.observations[0].payload as { notes: string[] };
    expect(payload).not.toHaveProperty("keywordSeries");
    expect(payload.notes).not.toContain(
      SEO_STATISTICS_KEYWORD_SERIES_UNAVAILABLE_NOTE,
    );
  });

  it("stores daily rows of tracked keywords and hands them to the workspace", async () => {
    state.keywords.push(saved("Battery"), saved("charger", "high"));
    state.answer = gsc(
      { rows: [{ keys: ["battery", state.pageUrl], ...metric }] },
      { rows: [{ keys: ["2026-01-01", "battery"], ...metric }] },
    );
    const workspace = await syncProjectSeoStatistics(actor, gscInput);
    expect(seriesRead()).toHaveLength(1);
    const series = {
      rowLimit: 10_000,
      truncated: false,
      keywords: [
        { keyword: "charger", points: [] },
        {
          keyword: "battery",
          points: [
            { date: "2026-01-01", clicks: 1, impressions: 9, position: 4.2 },
          ],
        },
      ],
    };
    expect(state.observations[0].payload).toMatchObject({
      keywordSeries: series,
    });
    expect(workspace.searchQueries?.keywordSeries).toEqual(series);
  });

  it("keeps totals and query rows and says so when the keyword read fails", async () => {
    state.keywords.push(saved("battery"));
    state.answer = gsc(
      { rows: [{ keys: ["battery", state.pageUrl], ...metric }] },
      { rows: [{ keys: ["2026-01-01", "other query"], ...metric }] },
    );
    await syncProjectSeoStatistics(actor, gscInput);
    const payload = state.observations[0].payload as {
      keywordSeries?: unknown;
      queries?: { rows: unknown[] };
      notes: string[];
      metrics: Array<{ value: number | null }>;
    };
    expect(payload.keywordSeries).toBeUndefined();
    expect(payload.metrics[0].value).toBe(1);
    expect(payload.queries?.rows).toHaveLength(1);
    expect(payload.notes).toContain(
      SEO_STATISTICS_KEYWORD_SERIES_UNAVAILABLE_NOTE,
    );
    expect(seoStatisticsLostData(payload.notes)).toBe(false);
  });
});
