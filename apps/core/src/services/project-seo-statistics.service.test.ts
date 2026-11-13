import {
  SEO_STATISTICS_BREAKDOWN_UNAVAILABLE_NOTE,
  SEO_STATISTICS_INDEX_STATUS_UNAVAILABLE_NOTE,
  SEO_STATISTICS_KEYWORD_SERIES_UNAVAILABLE_NOTE,
  seoStatisticsLostData,
} from "@sokosumi/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      // The workspace reads public evidence (no owner) and metric snapshots (an owner) apart.
      findMany: async ({ where }: { where: { ownerId?: unknown } }) =>
        state.observations.filter((row) =>
          where.ownerId === null ? !row.ownerId : Boolean(row.ownerId),
        ),
      // No brand terms saved.
      findFirst: async () => null,
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
        slug: "GOOGLE_SEARCH_CONSOLE_INSPECT_URL",
        readOnly: true,
        inputSchema: {
          properties: { site_url: {}, inspection_url: {}, language_code: {} },
          required: ["site_url", "inspection_url"],
        },
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
            aggregation_type: {},
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

import { z } from "@hono/zod-openapi";
import { runSeoTool } from "@/lib/soko-bot/seo-tools";
import { nativeSeoMetricsSchema } from "@/schemas/project-seo-native-metrics.schema";
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
function landing(path: string) {
  return {
    dimensionHeaders: [{ name: "landingPagePlusQueryString" }],
    metricHeaders: [{ name: "sessions" }, { name: "keyEvents" }],
    rows: [
      {
        dimensionValues: [{ value: path }],
        metricValues: [{ value: "5" }, { value: "2" }],
      },
    ],
  };
}
function answer(slug: string, args: Record<string, unknown>) {
  const dimensions = (args.dimensions ?? []) as Array<{ name: string }>;
  const data = slug.endsWith("SUMMARIES")
    ? {
        accountSummaries: [
          { propertySummaries: [{ property: "properties/123" }] },
        ],
      }
    : dimensions[0]?.name === "landingPagePlusQueryString"
      ? landing("/a")
      : ga4(dimensions.length > 0);
  return { successful: true, data: JSON.stringify(data) };
}
afterEach(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  // Search Console retention is judged from today; the fixtures sit in January 2026.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-20T12:00:00Z"));
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
    // Totals, days, landing pages, and the totals before. Google reported only Jan 1, so the earlier window is 1 day.
    expect(state.reads).toHaveLength(5);
    expect(state.reads[1].args.limit).toBe(400);
    expect(state.reads.map((read) => read.args.dateRanges).at(-1)).toEqual([
      { startDate: "2025-12-31", endDate: "2025-12-31" },
    ]);
    const payload = state.observations[0].payload as {
      metrics: Array<{ key: string; previous?: unknown }>;
    };
    expect(payload.metrics[0]).toMatchObject({
      key: "page_views",
      previous: { from: "2025-12-31", to: "2025-12-31", value: 6 },
    });
  });
  it("stores organic key events per landing page and hands them to the workspace", async () => {
    const workspace = await syncProjectSeoStatistics(actor, input);
    const read = state.reads.find((item) =>
      JSON.stringify(item.args.dimensions ?? []).includes("landingPage"),
    );
    expect(JSON.stringify(read?.args.dimensionFilter)).toContain(
      "Organic Search",
    );
    const payload = state.observations[0].payload as { notes: string[] };
    expect(payload).toMatchObject({
      landingPages: {
        channel: "organic",
        rows: [{ pageUrl: state.pageUrl, sessions: 5, keyEvents: 2 }],
      },
    });
    expect(workspace.landingPages?.rows).toEqual([
      { pageUrl: state.pageUrl, sessions: 5, keyEvents: 2 },
    ]);
  });

  it("keeps the totals and says so when the landing page read fails", async () => {
    state.answer = (slug, args) =>
      JSON.stringify(args.dimensions ?? []).includes("landingPage")
        ? { successful: false, error: "quota" }
        : answer(slug, args);
    await syncProjectSeoStatistics(actor, input);
    const payload = state.observations[0].payload as {
      landingPages?: unknown;
      notes: string[];
      metrics: Array<{ value: number | null }>;
    };
    expect(payload.landingPages).toBeUndefined();
    expect(payload.metrics[0].value).toBe(6);
    expect(payload.notes.join(" ")).toContain(
      "key events per landing page were unavailable",
    );
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
      if (slug.endsWith("INSPECT_URL"))
        return {
          inspectionResult: {
            indexStatusResult: {
              verdict: "PASS",
              coverageState: "Submitted and indexed",
            },
          },
        };
      const dimensions = args.dimensions as string[];
      if (dimensions.join() === "country")
        return { rows: [{ keys: ["deu"], ...metric }] };
      if (dimensions.join() === "device")
        return { rows: [{ keys: ["MOBILE"], ...metric }] };
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

  it("stores no earlier-window value when that read fails, and keeps the totals", async () => {
    const current = gsc({ rows: [] });
    state.answer = (slug, args) => {
      if (args.end_date === "2025-12-31")
        return { successful: false, error: "quota" };
      return current(slug, args);
    };
    await syncProjectSeoStatistics(actor, gscInput);
    expect(
      state.reads.some((read) => read.args.end_date === "2025-12-31"),
    ).toBe(true);
    const payload = state.observations[0].payload as {
      metrics: Array<{ value: number | null; previous?: unknown }>;
    };
    expect(payload.metrics[0].value).toBe(1);
    expect(payload.metrics.every((metric) => !metric.previous)).toBe(true);
  });

  it("keeps the earlier window as long as the settled period when the page goes quiet", async () => {
    // Google settled Jan 2, but the page had rows only on Jan 1.
    state.answer = gsc({ rows: [] });
    await syncProjectSeoStatistics(actor, gscInput);
    const payload = state.observations[0].payload as {
      metrics: Array<{ previous?: { from: string; to: string } }>;
    };
    expect(payload.metrics[0].previous).toMatchObject({
      from: "2025-12-30",
      to: "2025-12-31",
    });
  });

  it("ends the earlier window on the last reported day while Google still processes", async () => {
    // On Jan 4 Google has settled only Jan 1, the last reported day.
    vi.setSystemTime(new Date("2026-01-04T12:00:00Z"));
    state.answer = gsc({ rows: [] });
    await syncProjectSeoStatistics(actor, gscInput);
    const payload = state.observations[0].payload as {
      metrics: Array<{ previous?: { from: string; to: string } }>;
    };
    expect(payload.metrics[0].previous).toMatchObject({
      from: "2025-12-31",
      to: "2025-12-31",
    });
  });

  it("counts the settled day in Pacific Time, as Search Console does", async () => {
    // 02:00 UTC on Jan 5 is still Jan 4 in Pacific Time, so Google settled Jan 1.
    vi.setSystemTime(new Date("2026-01-05T02:00:00Z"));
    state.answer = gsc({ rows: [] });
    await syncProjectSeoStatistics(actor, gscInput);
    const payload = state.observations[0].payload as {
      metrics: Array<{ previous?: { from: string; to: string } }>;
    };
    expect(payload.metrics[0].previous).toMatchObject({
      from: "2025-12-31",
      to: "2025-12-31",
    });
  });

  it("never ends the earlier window before the period's last reported day", async () => {
    // On Jan 3 the settled day (Dec 31) falls before the period starts.
    vi.setSystemTime(new Date("2026-01-03T12:00:00Z"));
    state.answer = gsc({ rows: [] });
    await syncProjectSeoStatistics(actor, gscInput);
    const payload = state.observations[0].payload as {
      metrics: Array<{ previous?: { from: string; to: string } }>;
    };
    expect(payload.metrics[0].previous).toMatchObject({
      from: "2025-12-31",
      to: "2025-12-31",
    });
  });

  it("skips the earlier window when Search Console no longer keeps it", async () => {
    // More than 480 days later, the window before the period is past retention.
    vi.setSystemTime(new Date("2027-06-01T12:00:00Z"));
    state.answer = gsc({ rows: [] });
    await syncProjectSeoStatistics(actor, gscInput);
    expect(
      state.reads.some((read) => read.args.end_date === "2025-12-31"),
    ).toBe(false);
    const payload = state.observations[0].payload as {
      metrics: Array<{ value: number | null; previous?: unknown }>;
    };
    expect(payload.metrics[0].value).toBe(1);
    expect(payload.metrics.every((metric) => !metric.previous)).toBe(true);
  });

  it("gives no earlier position or rate when the earlier window had no impressions", async () => {
    const current = gsc({ rows: [] });
    state.answer = (slug, args) =>
      args.end_date === "2025-12-31"
        ? {
            rows: [
              { keys: [], clicks: 0, impressions: 0, ctr: 0, position: 0 },
            ],
          }
        : current(slug, args);
    await syncProjectSeoStatistics(actor, gscInput);
    const payload = state.observations[0].payload as {
      metrics: Array<{ key: string; previous?: { value: number | null } }>;
    };
    const before = Object.fromEntries(
      payload.metrics.map((metric) => [metric.key, metric.previous?.value]),
    );
    expect(before).toEqual({
      clicks: 0,
      impressions: 0,
      ctr: null,
      position: null,
    });
  });

  it("stores totals by country and by device and hands them to the workspace", async () => {
    state.answer = gsc({
      rows: [{ keys: ["battery", state.pageUrl], ...metric }],
    });
    const workspace = await syncProjectSeoStatistics(actor, gscInput);
    const byCountry = state.reads.find(
      (read) =>
        (read.args.dimensions as string[] | undefined)?.join() === "country",
    );
    const totals = state.reads.find(
      (read) => (read.args.dimensions as string[] | undefined)?.length === 0,
    );
    // The same page filter as the totals, so the rows add up to the same pages.
    expect(byCountry?.args.dimension_filter_groups).toEqual(
      totals?.args.dimension_filter_groups,
    );
    const row = {
      clicks: 1,
      impressions: 9,
      ctr: 0.11,
      averagePosition: 4.2,
    };
    expect(workspace.searchBreakdown?.countries?.rows).toEqual([
      { key: "DE", ...row },
    ]);
    expect(workspace.searchBreakdown?.devices?.rows).toEqual([
      { key: "mobile", ...row },
    ]);
    const payload = state.observations[0].payload as { notes: string[] };
    expect(payload.notes).not.toContain(
      SEO_STATISTICS_BREAKDOWN_UNAVAILABLE_NOTE,
    );
  });

  it("stores Google's index verdict for each page and hands it to the workspace", async () => {
    state.answer = gsc({ rows: [] });
    const workspace = await syncProjectSeoStatistics(actor, gscInput);
    const inspection = state.reads.find((read) =>
      read.slug.endsWith("INSPECT_URL"),
    );
    expect(inspection?.args).toEqual({
      site_url: gscInput.propertyId,
      inspection_url: state.pageUrl,
    });
    expect(workspace.indexStatus?.pages).toEqual([
      {
        checkedAt: expect.any(String),
        pageUrl: state.pageUrl,
        verdict: "PASS",
        coverageState: "Submitted and indexed",
        robotsTxtState: null,
        lastCrawlTime: null,
        googleCanonical: null,
        userCanonical: null,
      },
    ]);
    const payload = state.observations[0].payload as { notes: string[] };
    expect(payload.notes).not.toContain(
      SEO_STATISTICS_INDEX_STATUS_UNAVAILABLE_NOTE,
    );
  });

  it("stores no verdict and says so when Google does not answer the inspection", async () => {
    const current = gsc({ rows: [] });
    state.answer = (slug, args) =>
      slug.endsWith("INSPECT_URL")
        ? { successful: false, error: "quota" }
        : current(slug, args);
    const workspace = await syncProjectSeoStatistics(actor, gscInput);
    const payload = state.observations[0].payload as {
      notes: string[];
      indexedPages?: unknown;
      metrics: Array<{ value: number | null }>;
    };
    expect(payload.indexedPages).toBeUndefined();
    expect(workspace.indexStatus).toBeNull();
    expect(payload.metrics[0].value).toBe(1);
    expect(payload.notes).toContain(
      SEO_STATISTICS_INDEX_STATUS_UNAVAILABLE_NOTE,
    );
    expect(seoStatisticsLostData(payload.notes)).toBe(false);
  });

  it("keeps the other reads and says so when the device read fails", async () => {
    const current = gsc({
      rows: [{ keys: ["battery", state.pageUrl], ...metric }],
    });
    state.answer = (slug, args) =>
      (args.dimensions as string[] | undefined)?.join() === "device"
        ? { rows: [{ keys: ["watch"], ...metric }] }
        : current(slug, args);
    await syncProjectSeoStatistics(actor, gscInput);
    const payload = state.observations[0].payload as {
      notes: string[];
      countries?: unknown;
      devices?: unknown;
      queries?: unknown;
    };
    expect(payload.devices).toBeUndefined();
    expect(payload.countries).toBeDefined();
    expect(payload.queries).toBeDefined();
    expect(payload.notes).toContain(SEO_STATISTICS_BREAKDOWN_UNAVAILABLE_NOTE);
    expect(seoStatisticsLostData(payload.notes)).toBe(false);
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
        { keyword: "charger", countryCode: "US", points: [] },
        {
          keyword: "battery",
          countryCode: "US",
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

  it("reads each keyword country apart and drops the series when one read fails", async () => {
    state.keywords.push(saved("battery"), {
      ...saved("akku"),
      countryCode: "DE",
      languageCode: "de",
    });
    const current = gsc(
      { rows: [{ keys: ["battery", state.pageUrl], ...metric }] },
      { rows: [] },
    );
    let failGermany = false;
    state.answer = (slug, args) => {
      const groups = args.dimension_filter_groups as
        | Array<{ filters: Array<{ dimension: string; expression: string }> }>
        | undefined;
      const country = groups?.[0].filters.find(
        (filter) => filter.dimension === "country",
      )?.expression;
      if (country === "deu" && failGermany)
        return { successful: false, error: "quota" };
      return current(slug, args);
    };
    const workspace = await syncProjectSeoStatistics(actor, gscInput);
    expect(seriesRead()).toHaveLength(2);
    expect(
      workspace.searchQueries?.keywordSeries?.keywords.map((entry) => [
        entry.keyword,
        entry.countryCode,
      ]),
    ).toEqual([
      ["akku", "DE"],
      ["battery", "US"],
    ]);
    failGermany = true;
    state.observations.length = 0;
    await syncProjectSeoStatistics(actor, gscInput);
    const payload = state.observations[0].payload as {
      keywordSeries?: unknown;
      notes: string[];
    };
    // Half a series would read as "no impressions" for the failed country.
    expect(payload.keywordSeries).toBeUndefined();
    expect(payload.notes).toContain(
      SEO_STATISTICS_KEYWORD_SERIES_UNAVAILABLE_NOTE,
    );
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

  it("reads Discover without query rows or keyword days and keeps it apart from web search", async () => {
    state.keywords.push(saved("battery"));
    state.answer = gsc({
      rows: [{ keys: ["battery", state.pageUrl], ...metric }],
    });
    const workspace = await syncProjectSeoStatistics(actor, {
      ...gscInput,
      searchType: "discover",
    });
    const analytics = state.reads.filter((read) =>
      read.slug.endsWith("SEARCH_ANALYTICS_QUERY"),
    );
    expect(analytics.length).toBeGreaterThan(0);
    expect(
      analytics.every((read) => read.args.search_type === "discover"),
    ).toBe(true);
    expect(
      analytics.some((read) =>
        (read.args.dimensions as string[]).includes("query"),
      ),
    ).toBe(false);
    const payload = state.observations[0].payload as {
      searchType?: string;
      queries?: unknown;
      notes: string[];
    };
    expect(payload.searchType).toBe("discover");
    expect(payload.queries).toBeUndefined();
    expect(payload.notes.join(" ")).not.toContain(
      "query rows were unavailable",
    );
    expect(workspace.metrics[0]).toMatchObject({ searchType: "discover" });
  });

  it("stores a Discover split under keys that an older build skips as unknown", async () => {
    const current = gsc({ rows: [] });
    const { position: _position, ...feedMetric } = metric;
    state.answer = (slug, args) => {
      const dimension = (args.dimensions as string[] | undefined)?.join();
      if (dimension === "country")
        return { rows: [{ keys: ["deu"], ...feedMetric }] };
      if (dimension === "device")
        return { rows: [{ keys: ["MOBILE"], ...feedMetric }] };
      return current(slug, args);
    };
    const workspace = await syncProjectSeoStatistics(actor, {
      ...gscInput,
      searchType: "discover",
    });
    expect(workspace.searchBreakdown?.devices?.rows).toEqual([
      { key: "mobile", ...feedMetric, averagePosition: null },
    ]);
    // The build before Discover (aae582000f) read countries and devices with a
    // position on every row. Its projection skips a sync only when every issue
    // is an unknown key, and fails the whole Traffic view on any other issue.
    const baseRow = z
      .object({
        key: z.string(),
        clicks: z.number(),
        impressions: z.number(),
        ctr: z.number(),
        averagePosition: z.number().finite().min(1),
      })
      .strict();
    const baseSplit = z
      .object({
        rowLimit: z.number(),
        truncated: z.boolean(),
        rows: z.array(baseRow),
      })
      .strict();
    const {
      searchType: _searchType,
      feedCountries: _feedCountries,
      feedDevices: _feedDevices,
      landingPages: _landingPages,
      ...baseShape
    } = nativeSeoMetricsSchema.shape;
    const base = z
      .object({
        ...baseShape,
        countries: baseSplit.optional(),
        devices: baseSplit.optional(),
      })
      .strict()
      .safeParse(state.observations[0].payload);
    expect(base.error?.issues).toEqual([
      expect.objectContaining({
        code: "unrecognized_keys",
        keys: expect.arrayContaining(["feedCountries", "feedDevices"]),
      }),
    ]);
  });

  it("refuses the AI Assistant channel for Search Console before any read", async () => {
    await expect(
      syncProjectSeoStatistics(actor, {
        ...gscInput,
        channel: "ai_assistant",
      }),
    ).rejects.toThrow();
    expect(state.reads).toHaveLength(0);
  });

  it("refuses a search type for Google Analytics before any read", async () => {
    await expect(
      syncProjectSeoStatistics(actor, { ...input, searchType: "image" }),
    ).rejects.toThrow();
    expect(state.reads).toHaveLength(0);
  });
});
