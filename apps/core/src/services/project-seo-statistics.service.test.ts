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
    accountRevision: 0,
    auditAccess: null as {
      propertyId: string;
      connectionVersion: string;
      includeSitemaps?: true;
    } | null,
    auditPageUrls: [] as string[],
    briefGoal: null as string | null,
    locks: new Map<
      string,
      {
        key: string;
        isLocked: boolean;
        lockedBy: string | null;
        lockedAt: Date | null;
      }
    >(),
    pageUrl: "https://example.test/a",
    extraPages: [] as Array<{ id: string; url: string }>,
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
          ? [
              {
                composioAccountId: "account",
                sokoBotId: "personal-bot",
                updatedAt: new Date(state.at.getTime() + state.accountRevision),
              },
            ]
          : [],
    },
    projectSeoPage: {
      findFirst: async () => ({ url: state.pageUrl }),
      findMany: async () => [
        { ...page, url: state.pageUrl },
        ...state.extraPages.map((extra) => ({ ...page, ...extra })),
      ],
    },
    projectSeoScope: {
      findFirst: async () => scope,
      findMany: async () => [scope],
    },
    projectSeoObservation: {
      findUnique: async ({
        where,
      }: {
        where: Record<string, { sourceKey: string }>;
      }) =>
        state.observations.find(
          (row) => row.sourceKey === Object.values(where)[0].sourceKey,
        ) ?? null,
      // The workspace reads public evidence (no owner) and metric snapshots (an owner) apart.
      findMany: async ({
        where,
        take,
      }: {
        where: {
          kind?: string | object;
          ownerId?: unknown;
          payload?: { equals: string };
        };
        take?: number;
      }) =>
        state.observations
          .filter(
            (row) =>
              (where.ownerId === null ? !row.ownerId : Boolean(row.ownerId)) &&
              (!where.kind ||
                (typeof where.kind === "string"
                  ? row.kind === where.kind
                  : row.kind !== "landing_outcomes")) &&
              (!where.payload ||
                nativeSeoMetricsSchema.parse(row.payload)
                  .collectionFingerprint === where.payload.equals),
          )
          .sort(
            (a, b) =>
              new Date(String(b.observedAt)).getTime() -
              new Date(String(a.observedAt)).getTime(),
          )
          .slice(0, take),
      findFirst: async ({
        where,
      }: {
        where: {
          kind?: string;
          pageIds?: { hasSome: string[] };
          AND?: [
            { payload: { equals: string } },
            { payload: { array_contains: string[] } },
          ];
        };
      }) => {
        if (where.kind === "audit_brief" && state.briefGoal)
          return {
            createdAt: state.at,
            scopeVersion: 1,
            payload: {
              objective: "sales",
              audience: null,
              outcome: null,
              constraints: null,
              pages: [
                {
                  pageId: state.pageId,
                  role: "product",
                  job: null,
                  action: state.briefGoal,
                  indexIntent: "index",
                },
              ],
            },
          };
        if (where.kind === "landing_outcomes")
          return (
            state.observations.find(
              (row) =>
                row.kind === where.kind &&
                where.pageIds?.hasSome.some((id) =>
                  (row.pageIds as string[]).includes(id),
                ),
            ) ?? null
          );
        if (!where.AND) return null; // No brand terms saved.
        const key = where.AND[0].payload.equals;
        const [url] = where.AND[1].payload.array_contains;
        return (
          state.observations.toReversed().find((row) => {
            if (row.kind !== where.kind) return false;
            const parsed = nativeSeoMetricsSchema.safeParse(row.payload);
            const cache = parsed.success
              ? parsed.data.inspectionCache
              : undefined;
            return cache?.key === key && cache.readUrls.includes(url);
          }) ?? null
        );
      },
      upsert: async ({
        create,
        update,
      }: {
        create: Record<string, unknown>;
        update?: Record<string, unknown>;
      }) => {
        const existing = state.observations.find(
          (row) =>
            row.sourceKey === create.sourceKey &&
            row.kind === "audit_search_performance",
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
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
    projectSeoAnalysis: {
      findMany: async () => [],
      findUnique: async () => ({
        kind: "audit_full",
        requestedBy: "owner",
        auditId: null,
        projectId: state.projectId,
        pageIds: [state.pageId, ...state.extraPages.map((p) => p.id)],
        request: {
          searchConsoleAccess: state.auditAccess,
          pageUrls: state.auditPageUrls,
        },
        createdAt: new Date("2026-01-10T19:00:00Z"),
      }),
    },
    task: {
      findUnique: async () => ({
        status: "COMPLETED",
        ownerId: "owner",
        workspaceId: "workspace",
        projectId: state.projectId,
        organizationId: null,
      }),
    },
    $executeRaw: async () => 1,
    projectSeoActionTask: { findMany: async () => [] },
    taskSchedule: { findMany: async () => [] },
    lock: {
      upsert: async ({ create }: { create: { key: string } }) => {
        if (!state.locks.has(create.key))
          state.locks.set(create.key, {
            ...create,
            isLocked: false,
            lockedBy: null,
            lockedAt: null,
          });
        return state.locks.get(create.key);
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          key: string;
          isLocked?: boolean;
          lockedBy?: string;
          lockedAt?: { gte: Date };
          OR?: Array<{ lockedAt?: { lt: Date } }>;
        };
        data: Partial<NonNullable<ReturnType<typeof state.locks.get>>>;
      }) => {
        const lock = state.locks.get(where.key);
        if (
          !lock ||
          lock.key !== where.key ||
          (where.lockedBy !== undefined && lock.lockedBy !== where.lockedBy) ||
          (where.isLocked !== undefined && lock.isLocked !== where.isLocked) ||
          (where.lockedAt &&
            (!lock.lockedAt || lock.lockedAt < where.lockedAt.gte)) ||
          (where.OR &&
            lock.isLocked &&
            lock.lockedAt &&
            !where.OR.some(
              (part) => part.lockedAt && lock.lockedAt! < part.lockedAt.lt,
            ))
        )
          return { count: 0 };
        Object.assign(lock, data);
        return { count: 1 };
      },
    },
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
        slug: "GOOGLE_SEARCH_CONSOLE_LIST_SITEMAPS",
        readOnly: true,
        inputSchema: { properties: { site_url: {}, sitemap_index: {} } },
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
import prisma from "@/lib/db/prisma";
import { prepareAuditSettlement } from "@/lib/seo/audit-settlement";
import { runSeoTool } from "@/lib/soko-bot/seo-tools";
import { nativeSeoMetricsSchema } from "@/schemas/project-seo-native-metrics.schema";
import { expectCoreLog } from "@/test/core-log";
import { getProjectSeoWorkspace } from "./project-seo.service";
import { syncProjectSeoStatistics } from "./project-seo-statistics.service";
import { getSeoBrief } from "./seo-audit-brief.service";
import { collectSeoAuditPerformance } from "./seo-audit-performance";
import { readAuditPerformanceSummaries } from "./seo-audit-performance-summary";
import {
  connectionVersion,
  resolveSeoStatisticsIntegration,
} from "./seo-connections.service";
import { getSeoSiteTraffic } from "./seo-site-traffic";

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
    : dimensions[0]?.name === "hostName"
      ? {
          dimensionHeaders: [{ name: "hostName" }],
          metricHeaders: [{ name: "sessions" }],
          rows: [
            {
              dimensionValues: [{ value: new URL(state.pageUrl).hostname }],
              metricValues: [{ value: "5" }],
            },
          ],
          rowCount: 1,
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
  state.accountRevision = 0;
  state.auditAccess = null;
  state.auditPageUrls = [];
  state.briefGoal = null;
  state.locks.clear();
  state.extraPages.length = 0;
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

describe("Search Console site traffic with two connected properties", () => {
  const traffic = {
    from: input.from,
    to: input.to,
    searchType: "web" as const,
    scope: "site" as const,
    propertyId: "sc-domain:sample-site.test",
    pageIds: [state.pageId],
  };
  it("reads metrics from the open website only and refuses the other accessible property", async () => {
    state.pageUrl = "https://sample-site.test/";
    state.answer = (slug, args) => {
      if (slug.endsWith("LIST_SITES"))
        return {
          siteEntry: [traffic.propertyId, "sc-domain:second-site.test"].map(
            (siteUrl) => ({ siteUrl, permissionLevel: "siteOwner" }),
          ),
        };
      if (slug.endsWith("INSPECT_URL")) return {};
      return {
        rows: (args.dimensions as string[]).length
          ? [
              {
                keys: ["https://www.sample-site.test/about"],
                clicks: 3,
                impressions: 78,
              },
            ]
          : [{ clicks: 3, impressions: 78 }],
      };
    };
    const report = await getSeoSiteTraffic(actor, traffic);
    expect(report.pages.map((page) => page.url)).toEqual([
      "https://www.sample-site.test/about",
    ]);
    expect(report.totals).toEqual({ clicks: 3, impressions: 78 });
    expect(
      state.reads
        .filter((read) => !read.slug.endsWith("LIST_SITES"))
        .every((read) => read.args.site_url === traffic.propertyId),
    ).toBe(true);
    state.reads.length = 0;
    await expect(
      getSeoSiteTraffic(actor, {
        ...traffic,
        propertyId: "sc-domain:second-site.test",
      }),
    ).rejects.toThrow("for this website");
    expect(state.reads).toHaveLength(0);
    expect(state.observations).toHaveLength(0);
  });
});

describe("native statistics collection boundary", () => {
  it("reuses fresh automatic statistics without another Google request", async () => {
    await syncProjectSeoStatistics(actor, { ...input, automatic: true });
    const reads = state.reads.length;
    await syncProjectSeoStatistics(actor, { ...input, automatic: true });
    expect(state.reads).toHaveLength(reads);
    expect(state.observations).toHaveLength(1);
  });

  it("collects again after a connection revision changes despite the same account ID", async () => {
    await syncProjectSeoStatistics(actor, { ...input, automatic: true });
    const reads = state.reads.length;
    state.accountRevision++;
    await syncProjectSeoStatistics(actor, { ...input, automatic: true });
    expect(state.reads.length).toBeGreaterThan(reads);
    expect(state.observations).toHaveLength(2);
  });

  it("collects a fresh snapshot for a different traffic selection", async () => {
    await syncProjectSeoStatistics(actor, { ...input, automatic: true });
    const reads = state.reads.length;
    await syncProjectSeoStatistics(actor, {
      ...input,
      channel: "organic",
      automatic: true,
    });
    expect(state.reads.length).toBeGreaterThan(reads);
  });

  it("reactivates a previously collected selection without Google reads or renewing its freshness", async () => {
    await syncProjectSeoStatistics(actor, { ...input, automatic: true });
    const first = nativeSeoMetricsSchema.parse(state.observations[0].payload);
    vi.setSystemTime(new Date("2026-01-20T13:00:00Z"));
    await syncProjectSeoStatistics(actor, {
      ...input,
      channel: "organic",
      automatic: true,
    });
    const reads = state.reads.length;
    vi.setSystemTime(new Date("2026-01-20T14:00:00Z"));
    const workspace = await syncProjectSeoStatistics(actor, {
      ...input,
      automatic: true,
    });
    expect(state.reads).toHaveLength(reads);
    const activated = nativeSeoMetricsSchema.parse(
      state.observations.at(-1)?.payload,
    );
    expect(activated.collectedAt).toBe(first.collectedAt);
    expect(activated.observedAt).toBe("2026-01-20T14:00:00.000Z");
    expect(workspace.metrics[0].channel).toBe("all");
    expect(workspace.metrics[0].observedAt).toBe(first.observedAt);
    expect(workspace.metrics[0].selectedAt).toBe(activated.observedAt);
    vi.setSystemTime(new Date("2026-01-21T12:00:01Z"));
    await syncProjectSeoStatistics(actor, { ...input, automatic: true });
    expect(state.reads.length).toBeGreaterThan(reads);
  });

  it("refreshes an automatic snapshot after its freshness period", async () => {
    await syncProjectSeoStatistics(actor, { ...input, automatic: true });
    const reads = state.reads.length;
    vi.setSystemTime(new Date("2026-01-21T12:00:01Z"));
    await syncProjectSeoStatistics(actor, { ...input, automatic: true });
    expect(state.reads.length).toBeGreaterThan(reads);
  });

  it("does not retain automatic statistics after an account revision changes during collection", async () => {
    state.answer = (slug, args) => {
      if (slug.endsWith("RUN_REPORT")) state.accountRevision++;
      return answer(slug, args);
    };
    await expect(
      syncProjectSeoStatistics(actor, { ...input, automatic: true }),
    ).rejects.toThrow("connection changed");
    expect(state.observations).toHaveLength(0);
    expect([...state.locks.values()].every((lock) => !lock.isLocked)).toBe(
      true,
    );
  });

  it("releases the automatic lease after provider failures so a later request can recover", async () => {
    state.answer = () => {
      throw new Error("Google unavailable");
    };
    await expect(
      syncProjectSeoStatistics(actor, { ...input, automatic: true }),
    ).rejects.toThrow();
    expect([...state.locks.values()].every((lock) => !lock.isLocked)).toBe(
      true,
    );
    state.answer = answer;
    await syncProjectSeoStatistics(actor, { ...input, automatic: true });
    expect(state.observations).toHaveLength(1);
  });

  it("retains the sampling warning when only the earlier comparison period is sampled", async () => {
    state.answer = (slug, args) =>
      JSON.stringify(args.dateRanges ?? []).includes("2025-12-30")
        ? {
            successful: true,
            data: {
              ...ga4(false),
              metadata: {
                timeZone: "Europe/Oslo",
                samplingMetadatas: [
                  { samplesReadCount: "1", samplingSpaceSize: "100" },
                ],
              },
            },
          }
        : answer(slug, args);
    await syncProjectSeoStatistics(actor, input);
    const payload = nativeSeoMetricsSchema.parse(state.observations[0].payload);
    expect(payload.metrics[0].previous?.value).toBe(6);
    expect(payload.coverage).toBe("partial");
    expect(payload.notes.join(" ")).toContain(
      "Analytics reported sampled data",
    );
  });

  it("withholds previously stored landing totals that have no verified host while keeping page metrics", async () => {
    await syncProjectSeoStatistics(actor, input);
    const payload = nativeSeoMetricsSchema.parse(state.observations[0].payload);
    if (!payload.landingPages) throw new Error("Missing landing rows");
    delete payload.landingPages.verifiedHost;
    state.observations[0].payload = payload;
    const workspace = await getProjectSeoWorkspace(actor);
    expect(workspace.landingPages).toBeNull();
    expect(workspace.metrics[0].value).toBe(6);
    expect(workspace.metrics[0].notes.join(" ")).toContain(
      "key events per landing page were unavailable",
    );
  });

  it.each([
    "other-host",
    "multiple-hosts",
    "missing-count",
    "truncated",
    "thresholded",
    "sampled",
    "failed",
  ])(
    "withholds landing totals when property host scope is %s",
    async (problem) => {
      state.answer = (slug, args) => {
        const dimensions = (args.dimensions ?? []) as Array<{ name: string }>;
        if (dimensions[0]?.name !== "hostName") return answer(slug, args);
        if (problem === "failed")
          return { successful: false, error: "unavailable" };
        return {
          successful: true,
          data: {
            dimensionHeaders: [{ name: "hostName" }],
            metricHeaders: [{ name: "sessions" }],
            rows: [
              {
                dimensionValues: [
                  {
                    value:
                      problem === "other-host"
                        ? "blog.example.test"
                        : new URL(state.pageUrl).hostname,
                  },
                ],
                metricValues: [{ value: "5" }],
              },
              ...(problem === "multiple-hosts"
                ? [
                    {
                      dimensionValues: [{ value: "blog.example.test" }],
                      metricValues: [{ value: "10" }],
                    },
                  ]
                : []),
            ],
            ...(problem === "missing-count"
              ? {}
              : {
                  rowCount:
                    problem === "truncated" || problem === "multiple-hosts"
                      ? 2
                      : 1,
                }),
            metadata:
              problem === "thresholded"
                ? { subjectToThresholding: true }
                : problem === "sampled"
                  ? {
                      samplingMetadatas: [
                        { samplesReadCount: "1", samplingSpaceSize: "10" },
                      ],
                    }
                  : {},
          },
        };
      };
      await syncProjectSeoStatistics(actor, input);
      const payload = state.observations[0].payload as {
        landingPages?: unknown;
        metrics: Array<{ value: number }>;
        notes: string[];
      };
      expect(payload.landingPages).toBeUndefined();
      expect(payload.metrics[0].value).toBe(6);
      expect(payload.notes.join(" ")).toContain(
        "key events per landing page were unavailable",
      );
      expect(
        state.reads.some((read) =>
          JSON.stringify(read.args.dimensions ?? []).includes("landingPage"),
        ),
      ).toBe(false);
    },
  );

  it("stores measured owner-only observations through the existing native connection", async () => {
    await syncProjectSeoStatistics(actor, input);
    expect(state.observations).toHaveLength(1);
    expect(state.observations[0]).toMatchObject({
      ownerId: "owner",
      source: "ga4",
      pageIds: [state.pageId],
    });
    // The selected Jan 1-2 window has no traffic on Jan 2. Its earlier window still spans two days.
    expect(state.reads).toHaveLength(6);
    expect(state.reads[1].args.limit).toBe(400);
    expect(
      state.reads
        .map((read) => read.args.dateRanges)
        .find((ranges) =>
          (JSON.stringify(ranges) ?? "").includes("2025-12-31"),
        ),
    ).toEqual([{ startDate: "2025-12-30", endDate: "2025-12-31" }]);
    const payload = state.observations[0].payload as {
      metrics: Array<{ key: string; previous?: unknown }>;
    };
    expect(payload.metrics[0]).toMatchObject({
      key: "page_views",
      previous: { from: "2025-12-30", to: "2025-12-31", value: 6 },
    });
  });
  it("excludes ambiguous paths from the landing request when other pages can be measured", async () => {
    const alias = {
      id: "66666666-6666-4666-8666-666666666666",
      url: "http://example.test/a",
    };
    const distinct = {
      id: "77777777-7777-4777-8777-777777777777",
      url: "https://example.test/b",
    };
    state.extraPages.push(alias, distinct);
    state.answer = (slug, args) =>
      JSON.stringify(args.dimensions ?? []).includes(
        "landingPagePlusQueryString",
      )
        ? { successful: true, data: landing("/b") }
        : answer(slug, args);
    await syncProjectSeoStatistics(actor, {
      ...input,
      pageIds: [state.pageId, alias.id, distinct.id],
    });
    const requested = state.reads.find(({ args }) =>
      JSON.stringify(args.dimensions ?? []).includes(
        "landingPagePlusQueryString",
      ),
    );
    expect(requested?.args.dimensionFilter).toMatchObject({
      andGroup: {
        expressions: expect.arrayContaining([
          {
            filter: {
              fieldName: "landingPagePlusQueryString",
              inListFilter: { values: ["/b"], caseSensitive: true },
            },
          },
        ]),
      },
    });
    const saved = nativeSeoMetricsSchema.parse(state.observations[0].payload);
    expect(saved.landingPages).toMatchObject({
      rows: [{ pageUrl: distinct.url, sessions: 5 }],
      skippedUrls: [state.pageUrl, alias.url],
    });
  });

  it("compares observed landing rates on the first sync and checks the preceding window's host independently", async () => {
    const priorHost = { value: "example.test" };
    state.answer = (slug, args) => {
      const dimensions = (args.dimensions ?? []) as Array<{ name: string }>;
      const prior = JSON.stringify(args.dateRanges ?? []).includes(
        "2025-12-30",
      );
      if (dimensions[0]?.name === "hostName" && prior)
        return {
          successful: true,
          data: {
            dimensionHeaders: [{ name: "hostName" }],
            metricHeaders: [{ name: "sessions" }],
            rows: [
              {
                dimensionValues: [{ value: priorHost.value }],
                metricValues: [{ value: "5" }],
              },
            ],
            rowCount: 1,
          },
        };
      if (dimensions[0]?.name === "landingPagePlusQueryString")
        return {
          successful: true,
          data: {
            dimensionHeaders: dimensions,
            metricHeaders: args.metrics,
            rows: [
              {
                dimensionValues: [{ value: "/a" }],
                metricValues: (prior ? [5, 2, 50, 15] : [10, 3, 140, 60]).map(
                  (value) => ({ value }),
                ),
              },
            ],
            metadata: { timeZone: "Europe/Oslo" },
            rowCount: 1,
          },
        };
      return answer(slug, args);
    };
    const workspace = await syncProjectSeoStatistics(actor, input);
    expect(workspace.landingEngagementChange).toMatchObject({
      before: { from: "2025-12-30", to: "2025-12-31", sessions: 5 },
      after: { from: "2026-01-01", to: "2026-01-02", sessions: 10 },
      engagementSecondsPerSession: {
        before: 10,
        after: 14,
        withinPageChange: 4,
        mixChange: 0,
      },
      viewsPerSession: {
        before: 3,
        after: 6,
        withinPageChange: 3,
        mixChange: 0,
      },
    });
    expect(workspace.landingEngagementChange?.before.observationId).toBe(
      workspace.landingEngagementChange?.after.observationId,
    );
    priorHost.value = "another.test";
    vi.setSystemTime(new Date("2026-01-21T12:00:00Z"));
    const refreshed = await syncProjectSeoStatistics(actor, input);
    expect(refreshed.landingEngagementChange).toBeUndefined();
    expect(refreshed.landingPages?.rows[0].sessions).toBe(10);
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
        verifiedHost: "example.test",
        rows: [{ pageUrl: state.pageUrl, sessions: 5, keyEvents: 2 }],
      },
    });
    expect(workspace.landingPages?.rows).toEqual([
      { pageUrl: state.pageUrl, sessions: 5, keyEvents: 2 },
    ]);
  });

  it("keeps verified named organic event counts owner-private while public and workspace responses omit them", async () => {
    state.answer = (slug, args) =>
      JSON.stringify(args.dimensions ?? []).includes('"eventName"')
        ? {
            successful: true,
            data: JSON.stringify({
              dimensionHeaders: [
                { name: "landingPagePlusQueryString" },
                { name: "eventName" },
              ],
              metricHeaders: [{ name: "eventCount" }],
              rows: [
                {
                  dimensionValues: [{ value: "/a" }, { value: "purchase" }],
                  metricValues: [{ value: "12" }],
                },
              ],
              rowCount: 1,
              metadata: { timeZone: "Europe/Oslo" },
            }),
          }
        : answer(slug, args);
    state.briefGoal = "buy";
    const owner = { ...actor, sokoBotId: undefined };
    const workspace = await syncProjectSeoStatistics(owner, input);
    expect(
      (await getSeoBrief(owner)).followUps[0]?.latestClosedGoal,
    ).toMatchObject({ event: "purchase", count: 12, timeZone: "Europe/Oslo" });
    const evidence = state.observations.find(
      (r) => r.kind === "landing_outcomes",
    );
    expect(evidence).toMatchObject({
      ownerId: "owner",
      visibility: "PRIVATE",
      payload: {
        rows: [{ pageUrl: state.pageUrl, event: "purchase", count: 12 }],
      },
    });
    expect(JSON.stringify(workspace)).not.toContain('"purchase"');
    expect(
      JSON.stringify(
        state.observations.find((r) => r.kind === "metrics")?.payload,
      ),
    ).not.toContain('"purchase"');
    const request = state.reads.find((r) =>
      JSON.stringify(r.args.dimensions ?? []).includes('"eventName"'),
    );
    expect(request?.args.metrics).toEqual([{ name: "eventCount" }]);
    expect(JSON.stringify(request?.args.dimensionFilter)).toContain(
      "Organic Search",
    );
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
  it("refuses a replacement audit connection before reading private performance", async () => {
    state.answer = gsc({ rows: [] });
    await expect(
      syncProjectSeoStatistics(
        actor,
        gscInput,
        {},
        {
          taskId: "original-task",
          connectionVersion: "replaced",
          pageUrls: [state.pageUrl],
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.reads).toHaveLength(0);
    expect(state.observations).toHaveLength(0);
  });
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

  it("reads submitted sitemaps only for a bound consenting audit and shows concrete actions privately", async () => {
    const owner = { ...actor, sokoBotId: undefined };
    state.auditPageUrls = [state.pageUrl];
    const integration = await resolveSeoStatisticsIntegration(
      owner,
      "search_console",
    );
    state.auditAccess = {
      propertyId: gscInput.propertyId,
      connectionVersion: connectionVersion(integration!),
      includeSitemaps: true,
    };
    const fallback = gsc({ rows: [] });
    const map = "https://example.test/sitemap.xml";
    state.answer = (slug, args) =>
      slug.endsWith("LIST_SITEMAPS")
        ? { sitemap: [{ path: map, errors: "2", warnings: "0" }] }
        : slug.endsWith("INSPECT_URL")
          ? {
              inspectionResult: {
                indexStatusResult: {
                  verdict: "NEUTRAL",
                  coverageState: "Crawled - currently not indexed",
                },
              },
            }
          : fallback(slug, args);
    await collectSeoAuditPerformance("audit-task");
    const read = state.reads.filter((r) => r.slug.endsWith("LIST_SITEMAPS"));
    expect(read.map((r) => r.args)).toEqual([
      { site_url: gscInput.propertyId },
    ]);
    const summary = await readAuditPerformanceSummaries(owner, ["audit-task"]);
    expect(summary.auditSearchConsole[0].discovery).toMatchObject({
      status: "available",
      actions: [
        { url: map, evidence: "Google reported 2 errors." },
        {
          url: state.pageUrl,
          evidence: expect.stringContaining("Crawled - currently not indexed"),
        },
      ],
    });
    expect(
      (await readAuditPerformanceSummaries(actor, ["audit-task"]))
        .auditSearchConsole,
    ).toEqual([]);
    expect(state.observations[0]).toMatchObject({
      ownerId: "owner",
      visibility: "PRIVATE",
    });
    await collectSeoAuditPerformance("audit-task");
    expect(
      state.reads.filter((r) => r.slug.endsWith("LIST_SITEMAPS")),
    ).toHaveLength(1);
  });

  it("retries a failed sitemap inventory without recollecting performance or dating its evidence again", async () => {
    const owner = { ...actor, sokoBotId: undefined };
    state.auditPageUrls = [state.pageUrl];
    const account = await resolveSeoStatisticsIntegration(
      owner,
      "search_console",
    );
    state.auditAccess = {
      propertyId: gscInput.propertyId,
      connectionVersion: connectionVersion(account!),
      includeSitemaps: true,
    };
    const healthy = gsc({ rows: [] });
    const sitemap = "https://example.test/sitemap.xml";
    let recovered = false;
    state.answer = (slug, args) => {
      if (slug.endsWith("LIST_SITEMAPS"))
        return recovered
          ? { sitemap: [{ path: sitemap }] }
          : { error: "unavailable" };
      if (slug.endsWith("INSPECT_URL"))
        return {
          inspectionResult: {
            indexStatusResult: { verdict: "PASS", sitemap: [sitemap] },
          },
        };
      return healthy(slug, args);
    };
    await collectSeoAuditPerformance("audit-task", owner);
    const summary = () =>
      readAuditPerformanceSummaries(owner, ["audit-task"], ["audit-task"]);
    expect((await summary()).auditSearchConsoleRetryTaskIds).toEqual([
      "audit-task",
    ]);
    const initial = nativeSeoMetricsSchema.parse(state.observations[0].payload);
    const date = "2026-01-22T12:00:00.000Z";
    vi.setSystemTime(new Date(date));
    recovered = true;
    state.reads.length = 0;
    await collectSeoAuditPerformance("audit-task", owner);
    expect(
      state.reads
        .filter((r) => !r.slug.endsWith("LIST_SITES"))
        .map((r) => r.slug),
    ).toEqual(["GOOGLE_SEARCH_CONSOLE_LIST_SITEMAPS"]);
    expect(
      nativeSeoMetricsSchema.parse(state.observations[0].payload),
    ).toMatchObject({
      observedAt: initial.observedAt,
      metrics: initial.metrics,
      auditDiscovery: {
        checkedAt: date,
        status: "available",
        inspections: [
          { checkedAt: initial.observedAt, reportedSitemaps: [sitemap] },
        ],
      },
    });
    expect((await summary()).auditSearchConsoleRetryTaskIds).toEqual([]);
  });

  it("keeps private inspection sources across a dashboard cache hit and retries only the missing page", async () => {
    expectCoreLog("warn", "Audit URL Inspection returned no usable result.");
    const owner = { ...actor, sokoBotId: undefined };
    const other = {
      id: "77777777-7777-4777-8777-777777777777",
      url: "https://example.test/b",
    };
    const referring = "https://example.test/posts";
    state.extraPages.push(other);
    state.auditPageUrls = [state.pageUrl, other.url];
    const account = await resolveSeoStatisticsIntegration(
      owner,
      "search_console",
    );
    state.auditAccess = {
      propertyId: gscInput.propertyId,
      connectionVersion: connectionVersion(account!),
      includeSitemaps: true,
    };
    const healthy = gsc({ rows: [] });
    let available = false;
    state.answer = (slug, args) => {
      if (slug.endsWith("LIST_SITEMAPS")) return {};
      if (slug.endsWith("INSPECT_URL")) {
        if (args.inspection_url === other.url && !available)
          throw Error("unavailable");
        return {
          inspectionResult: {
            indexStatusResult: { verdict: "PASS", referringUrls: [referring] },
          },
        };
      }
      return healthy(slug, args);
    };
    await syncProjectSeoStatistics(owner, { ...gscInput, automatic: true });
    const dashboard = state.observations.find((row) => row.kind === "metrics");
    expect(JSON.stringify(dashboard)).not.toContain(referring);
    state.reads.length = 0;
    await collectSeoAuditPerformance("audit-task", owner);
    const reads = () =>
      state.reads
        .filter((r) => r.slug.endsWith("INSPECT_URL"))
        .map((r) => r.args.inspection_url);
    expect(reads().sort()).toEqual([state.pageUrl, other.url].sort());
    state.reads.length = 0;
    await collectSeoAuditPerformance("audit-task", owner);
    expect(reads()).toEqual([]);
    vi.setSystemTime(new Date("2026-01-20T13:01:00Z"));
    available = true;
    await collectSeoAuditPerformance("audit-task", owner);
    expect(reads()).toEqual([other.url]);
    expect(state.reads.filter((r) => r.slug.endsWith("LIST_SITEMAPS"))).toEqual(
      [],
    );
    const summary = await readAuditPerformanceSummaries(
      owner,
      ["audit-task"],
      ["audit-task"],
    );
    expect(summary.auditSearchConsoleRetryTaskIds).toEqual([]);
    expect(summary.auditSearchConsole[0].discovery?.inspections).toMatchObject([
      {
        page: state.pageUrl,
        referringPages: [referring],
        checkedAt: "2026-01-20T12:00:00.000Z",
      },
      {
        page: other.url,
        referringPages: [referring],
        checkedAt: "2026-01-20T13:01:00.000Z",
      },
    ]);
  });

  it.each([
    "a retried inspection",
    "a verified inspection in a legacy snapshot",
  ])(
    "repairs cached redirect traffic using %s and keeps query actions on the selected page",
    async (source) => {
      const canonical = "https://www.example.test/a";
      const request = { ...gscInput, automatic: true };
      const inspection = {
        verdict: "NEUTRAL" as const,
        googleCanonical: canonical,
        userCanonical: canonical,
      };
      let inspected = false;
      const healthy = gsc({
        rows: [{ keys: ["example", canonical], ...metric }],
      });
      state.answer = (slug, args) => {
        if (slug.endsWith("INSPECT_URL")) {
          if (!inspected) throw Error("Inspection temporarily unavailable");
          return { inspectionResult: { indexStatusResult: inspection } };
        }
        if (slug.endsWith("SEARCH_ANALYTICS_QUERY")) {
          const alias = JSON.stringify(args.dimension_filter_groups).includes(
            "www",
          );
          if (!(args.dimensions as string[]).length)
            return { rows: [{ ...metric, impressions: alias ? 78 : 0 }] };
          if (!alias) return { rows: [] };
        }
        return healthy(slug, args);
      };
      const first = await syncProjectSeoStatistics(actor, request);
      expect(
        first.metrics.find((row) => row.key === "impressions")?.value,
      ).toBe(0);
      inspected = true;
      if (source === "a verified inspection in a legacy snapshot") {
        // Earlier syncs stored the canonical inspection beside totals filtered to the submitted URL.
        const saved = nativeSeoMetricsSchema.parse(
          state.observations[0].payload,
        );
        saved.indexedPages = [
          {
            ...inspection,
            pageUrl: state.pageUrl,
            coverageState: "Page with redirect",
            robotsTxtState: null,
            lastCrawlTime: null,
          },
        ];
        state.observations[0].payload = saved;
      }
      vi.setSystemTime(new Date("2026-01-20T13:00:01Z"));
      const fixed = await syncProjectSeoStatistics(actor, request);
      expect(
        fixed.metrics.find((row) => row.key === "impressions")?.value,
      ).toBe(78);
      expect(fixed.searchQueries?.rows).toMatchObject([
        { query: "example", pageUrl: state.pageUrl },
      ]);
      const calls = state.reads.length;
      await syncProjectSeoStatistics(actor, request);
      expect(state.reads).toHaveLength(calls);
    },
  );

  it("recovers a redirecting page's performance from a fresh dashboard inspection while its own inspection is unavailable", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Audit URL Inspection returned no usable result.",
    );
    const owner = { ...actor, sokoBotId: undefined };
    state.auditPageUrls = [state.pageUrl];
    const account = await resolveSeoStatisticsIntegration(
      owner,
      "search_console",
    );
    state.auditAccess = {
      propertyId: gscInput.propertyId,
      connectionVersion: connectionVersion(account!),
      includeSitemaps: true,
    };
    const canonical = "https://www.example.test/a";
    const healthy = gsc({
      rows: [{ keys: ["charging", canonical], ...metric }],
    });
    let canInspect = false;
    state.answer = (slug, args) => {
      if (slug.endsWith("INSPECT_URL")) {
        if (!canInspect) throw new Error("URL Inspection unavailable");
        return {
          inspectionResult: {
            indexStatusResult: {
              verdict: "NEUTRAL",
              googleCanonical: canonical,
              userCanonical: canonical,
            },
          },
        };
      }
      if (slug.endsWith("LIST_SITEMAPS")) return {};
      if (
        slug.endsWith("SEARCH_ANALYTICS_QUERY") &&
        !JSON.stringify(args.dimension_filter_groups).includes("www")
      )
        return {
          rows:
            Array.isArray(args.dimensions) && !args.dimensions.length
              ? [{ keys: [], clicks: 0, impressions: 0, ctr: 0, position: 0 }]
              : [],
        };
      return healthy(slug, args);
    };
    await collectSeoAuditPerformance("audit-task", owner);
    const summary = () =>
      readAuditPerformanceSummaries(owner, ["audit-task"], ["audit-task"]);
    const initial = (await summary()).auditSearchConsole[0];
    expect(warnings[0]?.event.stage).toBe("performance_url_inspection");
    expect(initial).toMatchObject({
      measuredPages: [{ measuredUrl: state.pageUrl, basis: "unverified" }],
      clicks: 0,
      queries: { rows: [] },
    });
    canInspect = true;
    vi.setSystemTime(new Date("2026-01-20T12:30:00Z"));
    await syncProjectSeoStatistics(owner, { ...gscInput, automatic: true });
    canInspect = false;
    state.reads.length = 0;
    await collectSeoAuditPerformance("audit-task", owner);
    const report = await summary();
    expect(report.auditSearchConsole[0]).toMatchObject({
      from: initial.from,
      to: initial.to,
      clicks: metric.clicks,
      measuredPages: [
        {
          pageUrl: state.pageUrl,
          measuredUrl: canonical,
          basis: "google_canonical",
        },
      ],
      queries: { rows: [{ pageUrl: canonical, query: "charging" }] },
      discovery: { inspections: [] },
    });
    expect(report.auditSearchConsoleRetryTaskIds).toEqual(["audit-task"]);
    const analytics = state.reads.filter((r) =>
      r.slug.endsWith("SEARCH_ANALYTICS_QUERY"),
    );
    expect(analytics.length).toBeGreaterThan(0);
    for (const read of analytics)
      expect(JSON.stringify(read.args.dimension_filter_groups)).toContain(
        "www",
      );
  });

  it("collects the original 90 days under Google's www canonical once and keeps the selected URLs in private audit evidence", async () => {
    const owner = { ...actor, sokoBotId: undefined };
    const canonical = "https://www.example.test/a";
    state.extraPages.push({
      id: "44444444-4444-4444-8444-444444444445",
      url: canonical,
    });
    state.auditPageUrls = [state.pageUrl, canonical];
    // A limited audit uses the exact same task lifecycle without accessing Google.
    await collectSeoAuditPerformance("audit-task");
    expect(state.reads).toHaveLength(0);
    await expect(
      collectSeoAuditPerformance("audit-task", owner),
    ).rejects.toMatchObject({ status: 404 });
    const account = await resolveSeoStatisticsIntegration(
      owner,
      "search_console",
    );
    state.auditAccess = {
      propertyId: gscInput.propertyId,
      connectionVersion: connectionVersion(account!),
    };
    const healthy = gsc({
      rows: [{ keys: ["charging", canonical], ...metric }],
    });
    state.answer = (slug, args) =>
      slug.endsWith("INSPECT_URL")
        ? {
            inspectionResult: {
              indexStatusResult: {
                verdict: "PASS",
                googleCanonical: canonical,
                userCanonical: canonical,
              },
            },
          }
        : healthy(slug, args);
    await collectSeoAuditPerformance("audit-task");
    expect(state.observations).toHaveLength(1);
    expect(state.observations[0]).toMatchObject({
      kind: "audit_search_performance",
      visibility: "PRIVATE",
      ownerId: "owner",
      sourceTaskId: "audit-task",
    });
    const reports = await readAuditPerformanceSummaries(
      owner,
      ["audit-task"],
      ["audit-task"],
      new Set([state.pageUrl, canonical]),
    );
    const partialScope = await readAuditPerformanceSummaries(
      owner,
      ["audit-task"],
      [],
      new Set([state.pageUrl]),
    );
    expect(partialScope.auditSearchConsole[0]).not.toHaveProperty("countries");
    expect(reports.auditSearchConsoleRetryTaskIds).toEqual([]);
    const [report] = reports.auditSearchConsole;
    expect(report).toMatchObject({
      from: "2025-10-10",
      to: "2026-01-07",
      clicks: 1,
      impressions: 9,
      countries: {
        truncated: false,
        rows: [{ key: "DE", clicks: 1, impressions: 9 }],
      },
      previous: { from: "2025-07-12", to: "2025-10-09" },
      opportunities: [
        { title: 'Strengthen the page for "charging"', pageUrl: canonical },
      ],
      measuredPages: [
        {
          pageUrl: state.pageUrl,
          measuredUrl: canonical,
          basis: "google_canonical",
        },
        { pageUrl: canonical, measuredUrl: canonical, basis: "selected" },
      ],
      queries: { rows: [{ query: "charging", pageUrl: canonical }] },
    });
    for (const read of state.reads.filter((r) =>
      r.slug.endsWith("SEARCH_ANALYTICS_QUERY"),
    )) {
      expect(JSON.stringify(read.args.dimension_filter_groups)).toContain(
        "www",
      );
      expect(read.slug).toContain("SEARCH_CONSOLE");
    }
    const reads = state.reads.length;
    await collectSeoAuditPerformance("audit-task");
    expect(state.observations).toHaveLength(1);
    expect(state.reads).toHaveLength(reads);
    expect(
      (await readAuditPerformanceSummaries(actor, ["audit-task"]))
        .auditSearchConsole,
    ).toEqual([]);
  });

  it.each([
    {
      recent: 60,
      prior: 100,
      year: 90,
      days: 90,
      decision: "investigate_loss",
    },
    { recent: 60, prior: 100, year: 58, days: 90, decision: "monitor" },
    {
      recent: 110,
      prior: 60,
      year: 90,
      days: 90,
      decision: "investigate_growth",
    },
    {
      recent: 110,
      prior: 60,
      year: 90,
      days: 89,
      decision: "insufficient_history",
    },
    {
      recent: 110,
      prior: 60,
      year: 0,
      days: 0,
      decision: "insufficient_history",
    },
    { recent: 60, prior: 59, year: 90, days: 90, decision: undefined },
  ])(
    "compares the approved canonical with last year only for a material change ($recent/$prior/$days)",
    async ({ recent, prior, year, days, decision }) => {
      const owner = { ...actor, sokoBotId: undefined };
      const account = await resolveSeoStatisticsIntegration(
        owner,
        "search_console",
      );
      state.auditPageUrls = [state.pageUrl];
      state.auditAccess = {
        propertyId: gscInput.propertyId,
        connectionVersion: connectionVersion(account!),
      };
      const healthy = gsc({ rows: [] });
      const canonical = "https://www.example.test/a";
      const historicalReads: Record<string, unknown>[] = [];
      state.answer = (slug, args) => {
        if (slug.endsWith("INSPECT_URL"))
          return {
            inspectionResult: {
              indexStatusResult: {
                verdict: "PASS",
                googleCanonical: canonical,
                userCanonical: canonical,
              },
            },
          };
        if (args.start_date === "2024-10-11") {
          historicalReads.push(args);
          return {
            rows: Array.from({ length: days }, (_, i) => {
              const day = new Date(Date.UTC(2024, 9, 11 + i))
                .toISOString()
                .slice(0, 10);
              const clicks = Math.floor(year / 90) + (i < year % 90 ? 1 : 0);
              return {
                keys: [day],
                ...metric,
                clicks,
                ctr: clicks / metric.impressions,
              };
            }),
          };
        }
        if ((args.dimensions as string[] | undefined)?.length === 0)
          return {
            rows: [
              {
                keys: [],
                ...metric,
                clicks: args.start_date === "2025-10-10" ? recent : prior,
                impressions: 1000,
              },
            ],
          };
        return healthy(slug, args);
      };
      await collectSeoAuditPerformance("audit-task", owner);
      const { auditSearchConsole } = await readAuditPerformanceSummaries(
        owner,
        ["audit-task"],
      );
      expect(historicalReads).toHaveLength(decision ? 1 : 0);
      if (decision) {
        expect(
          JSON.stringify(historicalReads[0].dimension_filter_groups),
        ).toContain("www");
        expect(auditSearchConsole[0]).toMatchObject({
          history: {
            from: "2024-10-11",
            to: "2025-01-08",
            reason:
              recent > prior ? "recent_click_growth" : "recent_click_decline",
            clicks: days === 90 ? year : null,
            coverage:
              days === 90 ? "complete" : days ? "partial" : "unavailable",
            decision,
          },
        });
      } else expect(auditSearchConsole[0]).not.toHaveProperty("history");
    },
  );

  it("refuses an unrelated requester or owner scope and discards reads when access changes in flight", async () => {
    const owner = { ...actor, sokoBotId: undefined };
    const account = await resolveSeoStatisticsIntegration(
      owner,
      "search_console",
    );
    state.auditPageUrls = [state.pageUrl];
    state.auditAccess = {
      propertyId: gscInput.propertyId,
      connectionVersion: connectionVersion(account!),
    };
    for (const unauthorized of [
      actor,
      { ...owner, userId: "member" },
      { ...owner, owner: { kind: "audit" as const, id: actor.owner.id } },
    ]) {
      await expect(
        collectSeoAuditPerformance("audit-task", unauthorized),
      ).rejects.toMatchObject({ status: 404 });
    }
    expect(state.reads).toHaveLength(0);
    const healthy = gsc({ rows: [] });
    state.answer = (slug, args) => {
      if (slug.endsWith("SEARCH_ANALYTICS_QUERY"))
        state.integrationActive = false;
      return healthy(slug, args);
    };
    await expect(
      collectSeoAuditPerformance("audit-task", owner),
    ).rejects.toMatchObject({ status: 422 });
    expect(state.observations).toHaveLength(0);
  });

  it("retries approved native audits on ordinary completion without triggering work for a limited one", async () => {
    const task = {
      id: "audit-task",
      ownerId: actor.userId,
      workspaceId: actor.workspaceId,
      organizationId: null,
      projectId: state.projectId,
      assigneeId: "worker",
    };
    let approved = false;
    await prepareAuditSettlement(
      prisma,
      task,
      { status: "COMPLETED" },
      false,
      () => {
        approved = true;
      },
    );
    expect(approved).toBe(false);
    state.auditAccess = {
      propertyId: gscInput.propertyId,
      connectionVersion: "a".repeat(64),
    };
    await prepareAuditSettlement(
      prisma,
      task,
      { status: "COMPLETED" },
      false,
      () => {
        approved = true;
      },
    );
    expect(approved).toBe(true);
    expect(state.reads).toHaveLength(0);
  });

  it("retains a usable current total across a partial retry and removes the retry action when Google recovers", async () => {
    const owner = { ...actor, sokoBotId: undefined };
    const account = await resolveSeoStatisticsIntegration(
      owner,
      "search_console",
    );
    state.auditPageUrls = [state.pageUrl];
    state.auditAccess = {
      propertyId: gscInput.propertyId,
      connectionVersion: connectionVersion(account!),
    };
    const healthy = gsc({
      rows: [{ keys: ["charging", state.pageUrl], ...metric }],
    });
    state.answer = (slug, args) => {
      if ((args.dimensions as string[] | undefined)?.includes("query"))
        throw Error("unavailable");
      return healthy(slug, args);
    };
    await collectSeoAuditPerformance("audit-task", owner);
    const read = () =>
      readAuditPerformanceSummaries(owner, ["audit-task"], ["audit-task"]);
    expect((await read()).auditSearchConsoleRetryTaskIds).toEqual([
      "audit-task",
    ]);
    state.answer = (slug, args) => {
      if (
        (args.dimensions as string[] | undefined)?.length === 0 &&
        args.start_date === "2025-10-10"
      )
        throw Error("unavailable");
      return healthy(slug, args);
    };
    await collectSeoAuditPerformance("audit-task", owner);
    const second = await read();
    expect(second.auditSearchConsole[0]).toMatchObject({
      clicks: 1,
      coverage: "partial",
      queries: { rows: [{ query: "charging" }] },
    });
    expect(second.auditSearchConsoleRetryTaskIds).toEqual(["audit-task"]);
    state.answer = (slug, args) => {
      const dimensions = args.dimensions as string[] | undefined;
      if (dimensions)
        return {
          rows: dimensions.length
            ? []
            : [{ keys: [], clicks: 0, impressions: 0, ctr: 0, position: 0 }],
        };
      return healthy(slug, args);
    };
    await collectSeoAuditPerformance("audit-task", owner);
    const recovered = await read();
    const zero = {
      clicks: 0,
      impressions: 0,
      ctr: null,
      averagePosition: null,
    };
    expect(recovered.auditSearchConsole[0]).toMatchObject({
      ...zero,
      previous: zero,
    });
    expect(recovered.auditSearchConsoleRetryTaskIds).toEqual([]);
    expect(state.observations).toHaveLength(1);
  });

  it("keeps an answered but missing aggregate unknown after a finished collection", async () => {
    const owner = { ...actor, sokoBotId: undefined };
    const account = await resolveSeoStatisticsIntegration(
      owner,
      "search_console",
    );
    state.auditPageUrls = [state.pageUrl];
    state.auditAccess = {
      propertyId: gscInput.propertyId,
      connectionVersion: connectionVersion(account!),
    };
    const healthy = gsc({ rows: [] });
    state.answer = (slug, args) =>
      (args.dimensions as string[] | undefined)?.length === 0
        ? { rows: [] }
        : healthy(slug, args);
    await collectSeoAuditPerformance("audit-task", owner);
    const summary = await readAuditPerformanceSummaries(
      owner,
      ["audit-task"],
      ["audit-task"],
    );
    expect(summary.auditSearchConsole[0]).toMatchObject({
      coverage: "partial",
      clicks: null,
      impressions: null,
    });
    expect(summary.auditSearchConsoleRetryTaskIds).toEqual([]);
  });

  it("retries only a missing inspection after one hour and reuses it across search types", async () => {
    const healthy = gsc({ rows: [] });
    state.answer = (slug, args) => {
      if (slug.endsWith("INSPECT_URL"))
        throw new Error("Temporary inspection failure");
      return healthy(slug, args);
    };
    const request = { ...gscInput, automatic: true };
    const first = await syncProjectSeoStatistics(actor, request);
    expect(first.indexStatus).toBeNull();
    state.answer = healthy;
    const inspections = () =>
      state.reads.filter((read) => read.slug.endsWith("INSPECT_URL")).length;
    const reports = () =>
      state.reads.filter((read) => read.slug.includes("SEARCH_ANALYTICS_QUERY"))
        .length;
    vi.setSystemTime(new Date("2026-01-20T12:30:00Z"));
    await syncProjectSeoStatistics(actor, { ...request, searchType: "image" });
    expect(inspections()).toBe(1);
    const reportsBefore = reports();
    expect(reportsBefore).toBeGreaterThan(0);
    vi.setSystemTime(new Date("2026-01-20T13:00:01Z"));
    state.answer = (slug, args) => {
      if (slug.endsWith("INSPECT_URL"))
        vi.setSystemTime(new Date("2026-01-20T13:00:03Z"));
      return healthy(slug, args);
    };
    const recovered = await syncProjectSeoStatistics(actor, request);
    expect(recovered.indexStatus?.pages[0]).toMatchObject({
      verdict: "PASS",
      checkedAt: "2026-01-20T13:00:01.000Z",
    });
    expect(inspections()).toBe(2);
    expect(reports()).toBe(reportsBefore);
    expect(recovered.metrics[0].observedAt).toBe(first.metrics[0].observedAt);
    expect(recovered.metrics[0].selectedAt).toBe("2026-01-20T13:00:03.000Z");
    state.answer = healthy;
    vi.setSystemTime(new Date("2026-01-20T14:00:00Z"));
    const video = await syncProjectSeoStatistics(actor, {
      ...request,
      searchType: "video",
    });
    expect(inspections()).toBe(2);
    expect(video.indexStatus).toEqual(recovered.indexStatus);
    state.accountRevision++;
    await syncProjectSeoStatistics(actor, request);
    expect(inspections()).toBe(3);
  });

  it("retains fresh pages in the exact legacy report when another page needs an inspection retry", async () => {
    const other = {
      id: "77777777-7777-4777-8777-777777777777",
      url: "https://example.test/b",
    };
    state.extraPages.push(other);
    const healthy = gsc({ rows: [] });
    state.answer = (slug, args) => {
      if (slug.endsWith("INSPECT_URL") && args.inspection_url === other.url)
        throw new Error("Temporary inspection failure");
      return healthy(slug, args);
    };
    const request = { ...gscInput, automatic: true };
    await syncProjectSeoStatistics(actor, request);
    const legacy = nativeSeoMetricsSchema.parse(state.observations[0].payload);
    delete legacy.inspectionCache;
    state.observations[0].payload = legacy;
    const firstReads = state.reads.length;
    vi.setSystemTime(new Date("2026-01-20T14:00:00Z"));
    state.answer = healthy;
    await syncProjectSeoStatistics(actor, request);
    const inspected = state.reads
      .slice(firstReads)
      .filter(({ slug }) => slug.endsWith("INSPECT_URL"));
    expect(inspected.map(({ args }) => args.inspection_url)).toEqual([
      other.url,
    ]);
    const saved = nativeSeoMetricsSchema.parse(
      state.observations.at(-1)?.payload,
    );
    expect(saved.inspectionCache?.readUrls).toEqual([other.url]);
    expect(saved.inspectionCache?.checkedAt[state.pageUrl]).toEqual(
      legacy.observedAt,
    );
  });

  it("does not reactivate an older report while a new collection holds its lease", async () => {
    const healthy = gsc({ rows: [] });
    state.answer = healthy;
    const web = { ...gscInput, automatic: true };
    await syncProjectSeoStatistics(actor, web);
    vi.setSystemTime(new Date("2026-01-20T12:05:00Z"));
    await syncProjectSeoStatistics(actor, { ...web, searchType: "image" });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    state.answer = async (slug, args) => {
      if (slug.endsWith("SEARCH_ANALYTICS_QUERY")) {
        entered.resolve();
        await release.promise;
      }
      return healthy(slug, args);
    };
    const fresh = syncProjectSeoStatistics(actor, gscInput);
    try {
      await Promise.race([entered.promise, fresh]);
      await expect(syncProjectSeoStatistics(actor, web)).rejects.toMatchObject({
        status: 409,
      });
    } finally {
      release.resolve();
      await fresh;
    }
  });

  it("keeps partial Search Console data fresh for a day when query rows were collected", async () => {
    state.answer = gsc({ rows: [] });
    await syncProjectSeoStatistics(actor, { ...gscInput, automatic: true });
    const reads = state.reads.length;
    vi.setSystemTime(new Date("2026-01-20T14:00:00Z"));
    await syncProjectSeoStatistics(actor, { ...gscInput, automatic: true });
    expect(state.reads).toHaveLength(reads);
  });

  it("waits one hour before retrying a missing Search Console query read", async () => {
    state.answer = gsc(null);
    await syncProjectSeoStatistics(actor, { ...gscInput, automatic: true });
    const reads = state.reads.length;
    vi.setSystemTime(new Date("2026-01-20T12:30:00Z"));
    await syncProjectSeoStatistics(actor, { ...gscInput, automatic: true });
    expect(state.reads).toHaveLength(reads);
    vi.setSystemTime(new Date("2026-01-20T13:00:01Z"));
    await syncProjectSeoStatistics(actor, { ...gscInput, automatic: true });
    expect(state.reads.length).toBeGreaterThan(reads);
  });

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
    const answer = gsc({ rows: [] });
    state.answer = (slug, args) =>
      slug.endsWith("INSPECT_URL")
        ? {
            inspectionResult: {
              indexStatusResult: {
                verdict: "NEUTRAL",
                coverageState: "Excluded by 'noindex' tag",
                indexingState: "BLOCKED_BY_META_TAG",
              },
            },
          }
        : answer(slug, args);
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
        verdict: "NEUTRAL",
        coverageState: "Excluded by 'noindex' tag",
        indexingState: "BLOCKED_BY_META_TAG",
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
    expect(
      state.reads.filter((read) => read.slug.endsWith("INSPECT_URL")),
    ).toHaveLength(1);
    expect(payload).not.toHaveProperty("indexedPages");
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

it("uses two channel-control reads for an owner purchase goal, keeps them private and skips an unrelated goal", async () => {
  state.briefGoal = "buy";
  const period = { ...input, from: "2025-10-10", to: "2026-01-07" }; // The Traffic screen requests 90 days.
  let sampled = false;
  let allowPropertyB = false;
  let namedZone: string | null = null;
  state.answer = (slug, args) => {
    if (allowPropertyB && slug.endsWith("SUMMARIES"))
      return {
        successful: true,
        data: {
          accountSummaries: [
            {
              propertySummaries: [
                { property: "properties/123" },
                { property: "properties/456" },
              ],
            },
          ],
        },
      };
    const dimensions = args.dimensions as { name: string }[] | undefined;
    if (dimensions?.[0]?.name !== "landingPagePlusQueryString")
      return answer(slug, args);
    const prior = !JSON.stringify(args.dateRanges).includes(period.to);
    const control = dimensions[1]?.name === "sessionDefaultChannelGroup";
    if (dimensions[1]?.name === "eventName")
      return namedZone
        ? {
            successful: true,
            data: {
              dimensionHeaders: dimensions,
              metricHeaders: args.metrics,
              rowCount: 1,
              metadata: { timeZone: namedZone },
              rows: [
                {
                  dimensionValues: [{ value: "/a" }, { value: "purchase" }],
                  metricValues: [{ value: 3 }],
                },
              ],
            },
          }
        : { successful: false };
    const rows = control
      ? ["Direct", "Organic Search"].map((channel) => ({
          dimensionValues: [{ value: "/a" }, { value: channel }],
          metricValues: [{ value: 100 }, { value: prior ? 0.2 : 0.1 }],
        }))
      : [
          {
            dimensionValues: [{ value: "/a" }],
            metricValues: [100, prior ? 30 : 12, 500, 160].map((value) => ({
              value,
            })),
          },
        ];
    return {
      successful: true,
      data: {
        dimensionHeaders: dimensions,
        metricHeaders: args.metrics,
        metadata: {
          timeZone: "Europe/Oslo",
          ...(control && sampled && { samplingMetadatas: [{}] }),
        },
        rowCount: rows.length,
        rows,
      },
    };
  };
  namedZone = "Europe/Oslo";
  const user = { ...actor, sokoBotId: undefined };
  const workspace = await syncProjectSeoStatistics(user, {
    ...period,
    automatic: true,
  });
  const controls = () =>
    state.reads.filter((r) =>
      JSON.stringify(r.args.metrics ?? []).includes(
        "sessionKeyEventRate:purchase",
      ),
    );
  expect(controls()).toHaveLength(2);
  const args = controls().map((c) => c.args);
  expect(args.map((a) => a.dateRanges)).toEqual([
    [{ startDate: "2025-07-12", endDate: "2025-10-09" }],
    [{ startDate: "2025-10-10", endDate: "2026-01-07" }],
  ]);
  expect(
    state.observations.find((r) => r.kind === "landing_outcomes"),
  ).toMatchObject({
    ownerId: "owner",
    visibility: "PRIVATE",
    payload: {
      rows: [{ event: "purchase", count: 3 }],
      goalInvestigation: {
        event: "purchase",
        pageUrl: state.pageUrl,
        assessment: "both_declined",
        weekdayMix: "uneven",
        before: { organic: { sessions: 100, rate: 0.2 } },
        after: { direct: { sessions: 100, rate: 0.1 } },
      },
    },
  });
  expect(JSON.stringify(workspace)).not.toContain("goalInvestigation");
  expect(
    JSON.stringify(state.observations.find((r) => r.kind === "metrics")),
  ).not.toContain("goalInvestigation");
  expect(
    (await getSeoBrief(user)).followUps[0]?.goalInvestigation?.assessment,
  ).toBe("both_declined");
  // The owner's Actions priority names the measured decline and its next step.
  expect((await getSeoBrief(user)).priorities[0]).toMatchObject({
    pageId: state.pageId,
    nextStep: expect.stringContaining("Check the completion step"),
    why: expect.arrayContaining([
      expect.stringContaining("GA4 purchase rate: organic search 20.0%"),
    ]),
  });
  await expect(getSeoBrief(actor)).rejects.toMatchObject({ status: 403 });
  expect((await getSeoBrief(user)).followUps[0]?.latestClosedGoal?.count).toBe(
    3,
  );
  // A later selection can succeed at the property level even when its landing rows cannot be used.
  namedZone = null;
  allowPropertyB = true;
  sampled = true;
  vi.setSystemTime(new Date("2026-01-20T13:00:00Z"));
  await syncProjectSeoStatistics(user, {
    ...period,
    propertyId: "properties/456",
  });
  const other = (await getSeoBrief(user)).followUps[0];
  expect(other?.goalInvestigation).toBeUndefined();
  // Another property's selection retires the older decision from the priority too.
  expect(JSON.stringify((await getSeoBrief(user)).priorities)).not.toMatch(
    /GA4 purchase rate|completion step/,
  );
  expect(other?.latestClosedGoal).toBeUndefined();
  expect(other?.outcomes).toEqual([]);
  expect(controls()).toHaveLength(4);
  // Return to A with the same goal, then switch the connected account on that same property.
  vi.setSystemTime(new Date("2026-01-20T14:00:00Z"));
  sampled = false;
  namedZone = "Europe/Oslo";
  const callsBeforeReactivation = state.reads.length;
  await syncProjectSeoStatistics(user, { ...period, automatic: true });
  expect(state.reads).toHaveLength(callsBeforeReactivation);

  expect((await getSeoBrief(user)).followUps[0]?.latestClosedGoal?.count).toBe(
    3,
  );
  state.accountRevision++;
  sampled = true;
  namedZone = null;
  vi.setSystemTime(new Date("2026-01-20T15:00:00Z"));
  await syncProjectSeoStatistics(user, period);
  expect(
    (await getSeoBrief(user)).followUps[0]?.latestClosedGoal,
  ).toBeUndefined();
  expect(
    (await getSeoBrief(user)).followUps[0]?.goalInvestigation,
  ).toBeUndefined();
  state.reads.length = 0;
  sampled = true;
  state.observations.length = 0;
  await syncProjectSeoStatistics(user, period);
  expect(controls()).toHaveLength(2);
  expect(
    state.observations.some((row) => row.kind === "landing_outcomes"),
  ).toBe(false);
  expect(state.observations.some((row) => row.kind === "metrics")).toBe(true);
  namedZone = "America/Chicago";
  sampled = false;
  await syncProjectSeoStatistics(user, period);
  const mismatch = state.observations.find(
    (row) => row.kind === "landing_outcomes",
  )?.payload;
  expect(mismatch).toMatchObject({
    timeZone: namedZone,
    rows: [{ event: "purchase", count: 3 }],
  });
  expect(mismatch).not.toHaveProperty("goalInvestigation");
  expect(controls()).toHaveLength(2);
  state.briefGoal = "contact sales";
  await syncProjectSeoStatistics(user, period);
  expect(controls()).toHaveLength(2);
  state.briefGoal = "buy";
  namedZone = "Europe/Oslo";
  await syncProjectSeoStatistics(user, { ...period, from: "2025-12-31" });
  expect(controls()).toHaveLength(2);
});
