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
    projectSeoKeyword: { findMany: async () => [] },
    projectSeoCompetitor: { findMany: async () => [] },
    projectSeoAnalysis: { findMany: async () => [] },
    projectSeoActionTask: { findMany: async () => [] },
    taskSchedule: { findMany: async () => [] },
    $transaction: async (work: (tx: unknown) => unknown) => work(db),
  };
  return { default: db };
});
vi.mock("./soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: async () =>
    state.integrationActive
      ? [
          {
            id: "integration",
            sokoBotId: "personal-bot",
            composioAccountId: "account",
            connectorUserId: "owner",
            provider: { id: "google_analytics" },
          },
        ]
      : [],
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
}));

import { runSeoTool } from "@/lib/soko-bot/seo-tools";
import { syncProjectSeoStatistics } from "./project-seo-statistics.service";

const actor = {
  projectId: state.projectId,
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
