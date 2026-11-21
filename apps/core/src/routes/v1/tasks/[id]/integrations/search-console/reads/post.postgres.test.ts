/** Real Task authorization and PostgreSQL locking. Composio and Google are local fakes. */
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getWebAppBaseUrl } from "@/config/env";
import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";
import { importProjectSeoAudit } from "@/services/project-seo-import.service";
import {
  connectionVersion,
  resolveSeoStatisticsIntegration,
} from "@/services/seo-connections.service";
import { expectCoreLog } from "@/test/core-log";
import { legacyReport, siteStrategyReport } from "@/test-fixtures/project-seo";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";
import mountStatus from "../get";
import mount from "./post";

const { network, ids } = vi.hoisted(() => ({
  network: {
    tools: vi.fn(),
    describe: vi.fn(),
    fetch: vi.fn(),
    account: vi.fn(),
  },
  ids: { executor: crypto.randomUUID() },
}));
vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("@/clients/composio.client", () => ({
  getComposio: () => ({
    tools: {
      getRawComposioTools: network.tools,
      getRawComposioToolBySlug: network.describe,
    },
  }),
  getComposioConnectedAccount: network.account,
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      SEO_ANALYSIS_EXECUTOR: {
        mode: "global",
        coworkerId: ids.executor,
        canUsePaidSearchData: true,
        canSchedule: true,
      },
    }),
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres") &&
  ["127.0.0.1", "localhost"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  );
const ownerId = randomUUID(),
  workspaceId = randomUUID(),
  organizationId = randomUUID(),
  vendorId = randomUUID(),
  coworkerId = ids.executor,
  otherCoworkerId = randomUUID(),
  auditId = randomUUID();
const PAGE_URLS = ["https://example.test/a", "https://example.test/b"];
const PROPERTY = "sc-domain:example.test";
const LIST_TOOL = "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
  STATS_TOOL = "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
  INSPECT_TOOL = "GOOGLE_SEARCH_CONSOLE_INSPECT_URL";
const STATS_ARGS = [
  "site_url",
  "start_date",
  "end_date",
  "dimensions",
  "search_type",
  "data_state",
  "row_limit",
  "start_row",
  "dimension_filter_groups",
  "aggregation_type",
];
const descriptors = [LIST_TOOL, STATS_TOOL, INSPECT_TOOL].map((slug) => ({
  slug,
  name: slug,
  tags: ["readOnlyHint"],
  inputParameters: {
    type: "object",
    properties: Object.fromEntries(
      (slug === LIST_TOOL
        ? []
        : slug === STATS_TOOL
          ? STATS_ARGS
          : ["site_url", "inspection_url"]
      ).map((key) => [key, { type: "string" }]),
    ),
  },
}));
const SITES = {
  siteEntry: [
    { siteUrl: "https://other-client.test/", permissionLevel: "siteOwner" },
    { siteUrl: PROPERTY, permissionLevel: "siteOwner" },
    { siteUrl: "sc-domain:private.test", permissionLevel: "siteFullUser" },
  ],
};
const ROWS = {
  rows: [
    {
      keys: ["widget"],
      clicks: 3,
      impressions: 40,
      ctr: 0.075,
      position: 4.2,
    },
  ],
  responseAggregationType: "byPage",
};
const INSPECTION = {
  inspectionResult: {
    inspectionResultLink: "https://search.google.com/search-console/inspect",
    indexStatusResult: { verdict: "PASS", coverageState: "Submitted" },
  },
};

function day(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!enabled)("Task-scoped Search Console reads", () => {
  let taskId: string;
  let connectionId: string;
  let composioAccountId: string;
  let actor: AuthenticationContext;
  let reads: Array<{ slug: string; input: Record<string, unknown> }>;
  let providerHook:
    | ((slug: string) => Promise<Response | null> | Response | null)
    | undefined;
  const expected = {
    expectedOwnerId: ownerId,
    expectedOrganizationId: organizationId,
  };
  const sitesList = { operation: "sites.list", ...expected };
  const query = (extra: Record<string, unknown> = {}) => ({
    operation: "searchAnalytics.query",
    siteUrl: PROPERTY,
    query: {
      startDate: day(-30),
      endDate: day(-3),
      dimensions: ["query", "page"],
      rowLimit: 25_000,
      startRow: 0,
      ...extra,
    },
    ...expected,
  });
  const inspect = (inspectionUrl = PAGE_URLS[0]) => ({
    operation: "urlInspection.inspect",
    siteUrl: PROPERTY,
    inspectionUrl,
    ...expected,
  });

  function read(body: unknown) {
    return createTaskScheduleTestApp(mount, actor, null).request(
      `http://localhost/${taskId}/integrations/search-console/reads`,
      jsonRequest("POST", body),
    );
  }
  async function status() {
    const response = await createTaskScheduleTestApp(
      mountStatus,
      actor,
      null,
    ).request(
      `http://localhost/${taskId}/integrations/search-console`,
      jsonRequest("GET"),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return (await response.json()).data;
  }
  async function setAccess(access: unknown) {
    const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    const { searchConsoleAccess: _old, ...request } =
      analysis.request as Record<string, unknown>;
    await prisma.projectSeoAnalysis.update({
      where: { id: analysis.id },
      data: {
        request:
          access === undefined
            ? request
            : { ...request, searchConsoleAccess: access },
      } as never,
    });
  }
  async function kindOf(response: Response) {
    return (await response.json()).kind;
  }

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: ownerId,
        name: "Search Console bridge owner",
        email: `${ownerId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Search Console bridge",
        slug: organizationId,
        members: {
          create: {
            userId: ownerId,
            role: "member",
            seatAssignedAt: new Date(),
          },
        },
      },
    });
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { userId: null, organizationId },
    });
    await prisma.vendor.create({
      data: {
        id: vendorId,
        name: "Search Console bridge",
        slug: vendorId,
        coworkers: {
          create: [coworkerId, otherCoworkerId].map((id) => ({
            id,
            name: "Search Console fixture worker",
            slug: id,
            capabilities: ["tasks"],
            isWhitelisted: true,
          })),
        },
      },
    });
    await prisma.seoAudit.create({
      data: {
        id: auditId,
        workspaceId,
        createdById: ownerId,
        name: "Search Console bridge",
      },
    });
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    reads = [];
    providerHook = undefined;
    await prisma.vendorGrant.deleteMany({ where: { vendorId } });
    await prisma.projectSeoObservation.deleteMany({ where: { auditId } });
    await prisma.projectSeoAnalysis.deleteMany({ where: { auditId } });
    await prisma.projectSeoPage.deleteMany({ where: { auditId } });
    await prisma.task.deleteMany({ where: { ownerId } });
    await prisma.seoConnectionIntent.deleteMany({ where: { workspaceId } });
    await prisma.seoConnection.deleteMany({ where: { workspaceId } });
    const pages = await Promise.all(
      PAGE_URLS.map((url) =>
        prisma.projectSeoPage.create({ data: { auditId, url } }),
      ),
    );
    taskId = (
      await prisma.task.create({
        data: {
          ownerId,
          organizationId,
          workspaceId,
          assigneeId: coworkerId,
          name: "SEO audit with Search Console",
          status: "RUNNING",
        },
      })
    ).id;
    composioAccountId = randomUUID();
    connectionId = (
      await prisma.seoConnection.create({
        data: {
          workspaceId,
          userId: ownerId,
          provider: "search_console",
          status: "ACTIVE",
          revision: 1,
          composioAccountId,
          entityId: "fixture-owner-search-console",
        },
      })
    ).id;
    const integration = await resolveSeoStatisticsIntegration(
      { userId: ownerId, workspaceId },
      "search_console",
    );
    expect.assert(integration);
    await prisma.projectSeoAnalysis.create({
      data: {
        auditId,
        taskId,
        requestedBy: ownerId,
        kind: "audit_full",
        requestHash: "fixture-request-hash",
        idempotencyKey: randomUUID(),
        pageIds: pages.map((page) => page.id),
        request: {
          pageUrls: PAGE_URLS,
          countryCode: "US",
          languageCode: "en",
          searchConsoleAccess: {
            propertyId: PROPERTY,
            connectionVersion: connectionVersion(integration),
          },
        },
      },
    });
    actor = { actor: "coworker", coworkerId, vendorId };
    network.tools.mockResolvedValue(descriptors);
    network.describe.mockImplementation(async (slug: string) =>
      descriptors.find((tool) => tool.slug === slug),
    );
    network.account.mockRejectedValue(new Error("Composio outage fixture"));
    network.fetch.mockImplementation(
      async (url: string, options: RequestInit) => {
        const slug = decodeURIComponent(
          new URL(url).pathname.split("/").at(-1)!,
        );
        if (![LIST_TOOL, STATS_TOOL, INSPECT_TOOL].includes(slug))
          throw new Error("Unexpected provider operation in the fixture");
        reads.push({ slug, input: JSON.parse(String(options.body)) });
        const overridden = await providerHook?.(slug);
        if (overridden) return overridden;
        const data =
          slug === LIST_TOOL ? SITES : slug === STATS_TOOL ? ROWS : INSPECTION;
        return Response.json({ successful: true, data });
      },
    );
    vi.stubGlobal("fetch", network.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await prisma.task.deleteMany({ where: { ownerId } });
    await prisma.seoAudit.deleteMany({ where: { id: auditId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.coworker.deleteMany({ where: { vendorId } });
    await prisma.vendor.delete({ where: { id: vendorId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("returns Google's native bodies and lists only the approved property", async () => {
    const sites = await read(sitesList);
    expect(sites.status, await sites.clone().text()).toBe(200);
    expect(sites.headers.get("cache-control")).toBe("no-store");
    expect((await sites.json()).data).toEqual({
      status: 200,
      body: {
        siteEntry: [{ siteUrl: PROPERTY, permissionLevel: "siteOwner" }],
      },
    });
    const rows = await read(
      query({
        type: "web",
        dataState: "final",
        dimensionFilterGroups: [
          {
            groupType: "and",
            filters: [
              {
                dimension: "page",
                operator: "equals",
                expression: PAGE_URLS[0],
              },
            ],
          },
        ],
      }),
    );
    expect(rows.status, await rows.clone().text()).toBe(200);
    expect((await rows.json()).data).toEqual({ status: 200, body: ROWS });
    const inspected = await read(inspect());
    expect((await inspected.json()).data).toEqual({
      status: 200,
      body: INSPECTION,
    });
    expect(reads.map((entry) => entry.slug)).toEqual([
      LIST_TOOL,
      STATS_TOOL,
      INSPECT_TOOL,
    ]);
    for (const entry of reads)
      expect(entry.input.connected_account_id).toBe(composioAccountId);
    expect(reads[1]!.input.arguments).toMatchObject({
      site_url: PROPERTY,
      row_limit: 25_000,
      start_row: 0,
      search_type: "web",
      data_state: "final",
    });
    expect(reads[2]!.input.arguments).toEqual({
      site_url: PROPERTY,
      inspection_url: PAGE_URLS[0],
    });
  });

  it("refuses a stale owner or organization before any provider read", async () => {
    for (const body of [
      { ...sitesList, expectedOwnerId: randomUUID() },
      { ...query(), expectedOrganizationId: null },
    ]) {
      const response = await read(body);
      expect(response.status).toBe(409);
      expect(await kindOf(response)).toBe("task_context_changed");
    }
    expect(reads).toEqual([]);
  });

  it("requires the configured SEO worker's bare key on its own assigned Task", async () => {
    const callers: AuthenticationContext[] = [
      { actor: "user", userId: ownerId, organizationId, role: "user" },
      {
        actor: "coworker",
        coworkerId,
        vendorId,
        context: { userId: ownerId, organizationId },
      },
      { actor: "coworker", coworkerId: otherCoworkerId, vendorId },
    ];
    for (const caller of callers) {
      actor = caller;
      expect((await read(sitesList)).status).toBe(403);
    }
    expect(
      (
        await createTaskScheduleTestApp(mountStatus, actor, null).request(
          `http://localhost/${taskId}/integrations/search-console`,
        )
      ).status,
    ).toBe(403);
    actor = { actor: "coworker", coworkerId, vendorId };
    await prisma.task.update({
      where: { id: taskId },
      data: { assigneeId: otherCoworkerId },
    });
    expect((await read(sitesList)).status).toBe(403);
    await prisma.task.update({
      where: { id: taskId },
      data: { assigneeId: coworkerId },
    });
    await prisma.vendorGrant.create({
      data: {
        vendorId,
        workspaceId,
        status: "DENIED",
        permission: "workspace",
      },
    });
    expect((await read(sitesList)).status).toBe(403);
    expect(reads).toEqual([]);
  });

  it("refuses another property or a URL outside the property before any provider read", async () => {
    for (const body of [
      { ...query(), siteUrl: "https://other-client.test/" },
      { ...inspect(), siteUrl: "sc-domain:private.test" },
      inspect("https://foreign.test/page"),
    ]) {
      const response = await read(body);
      expect(response.status).toBe(409);
      expect(await kindOf(response)).toBe("seo_gsc_property");
    }
    expect(reads).toEqual([]);
  });

  it("refuses out-of-range queries instead of clamping them", async () => {
    for (const extra of [
      { rowLimit: 25_001 },
      { rowLimit: 0 },
      { startRow: 975_001 },
      { startDate: day(-3), endDate: day(-30) },
      { startDate: day(-500) },
      { dimensions: ["hour"] },
      {
        dimensionFilterGroups: [
          { filters: [{ dimension: "page", expression: "x".repeat(4097) }] },
        ],
      },
    ])
      expect((await read(query(extra))).status, JSON.stringify(extra)).toBe(
        422,
      );
    expect((await read({ ...sitesList, propertyId: PROPERTY })).status).toBe(
      422,
    );
    expect(reads).toEqual([]);
  });

  it("reads only while the Task runs, and reports status after completion", async () => {
    for (const taskStatus of ["READY", "COMPLETED"] as const) {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: taskStatus },
      });
      expect((await read(sitesList)).status).toBe(409);
    }
    expect(reads).toEqual([]);
    expect(await status()).toEqual({
      provider: "search-console",
      status: "CONNECTED",
      authenticationUrl: `${getWebAppBaseUrl().replace(/\/+$/, "")}/tasks/${taskId}?googleConnection=connect`,
      expiresAt: null,
    });
  });

  it("names the state of a limited, legacy, replaced or pending connection", async () => {
    await setAccess(null);
    expect(await status()).toMatchObject({
      status: "NOT_CONNECTED",
      reason: "limited_audit",
    });
    const limited = await read(sitesList);
    expect(limited.status).toBe(409);
    expect(await kindOf(limited)).toBe("seo_gsc_not_connected");
    await setAccess(undefined);
    expect(await status()).toMatchObject({
      status: "NOT_CONNECTED",
      reason: "not_connected",
    });
    await setAccess({
      propertyId: PROPERTY,
      connectionVersion: "0".repeat(64),
    });
    expect(await status()).toMatchObject({
      status: "NOT_CONNECTED",
      reason: "reconnect",
      expiresAt: null,
    });
    const replaced = await read(query());
    expect(replaced.status).toBe(409);
    expect(await kindOf(replaced)).toBe("seo_gsc_reconnect");
    const expiresAt = new Date(Date.now() + 600_000);
    await prisma.seoConnectionIntent.create({
      data: {
        connectionId: randomUUID(),
        workspaceId,
        userId: ownerId,
        provider: "search_console",
        toolkit: "google_search_console",
        authConfigId: "fixture-auth-config",
        connectorEntityId: "fixture-owner-search-console",
        executorEntityId: "fixture-owner-search-console",
        expectedRevision: 1,
        expiresAt,
      },
    });
    expect(await status()).toEqual(
      expect.objectContaining({
        status: "PENDING",
        reason: "reconnect",
        expiresAt: expiresAt.toISOString(),
      }),
    );
    expect(reads).toEqual([]);
  });

  it("returns no Google body when the Task or connection changes during the provider call", async () => {
    providerHook = async () => {
      await prisma.task.update({
        where: { id: taskId },
        data: { assigneeId: otherCoworkerId },
      });
      return null;
    };
    const reassigned = await read(query());
    expect(reassigned.status).toBe(403);
    expect(await reassigned.text()).not.toContain("widget");
    await prisma.task.update({
      where: { id: taskId },
      data: { assigneeId: coworkerId },
    });
    providerHook = async () => {
      await prisma.seoConnection.update({
        where: { id: connectionId },
        data: { revision: { increment: 1 } },
      });
      return null;
    };
    const replaced = await read(query());
    expect(replaced.status).toBe(409);
    expect(await kindOf(replaced)).toBe("seo_gsc_reconnect");
    expect(reads).toHaveLength(2);
  });

  it("maps provider failures to retryable 503 and a revoked account to reconnect", async () => {
    expectCoreLog("warn", "A Task-scoped Search Console read failed", 3);
    await prisma.seoConnection.update({
      where: { id: connectionId },
      data: { authConfigId: "fixture-auth-config" },
    });
    providerHook = () => new Response("upstream failed", { status: 500 });
    expect((await read(query())).status).toBe(503);
    providerHook = () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    };
    expect((await read(inspect())).status).toBe(503);
    providerHook = () =>
      Response.json({ successful: false, error: "invalid_grant" });
    network.account.mockResolvedValue({
      id: composioAccountId,
      status: "EXPIRED",
      toolkitSlug: "google_search_console",
      authConfigId: "fixture-auth-config",
      connectorUserId: "fixture-owner-search-console",
    });
    const revoked = await read(query());
    expect(revoked.status).toBe(409);
    expect(await kindOf(revoked)).toBe("seo_gsc_reconnect");
    expect(
      (
        await prisma.seoConnection.findUniqueOrThrow({
          where: { id: connectionId },
        })
      ).status,
    ).toBe("NEEDS_RECONNECT");
  });

  it("refuses an oversized reply and a reply that holds a credential field", async () => {
    providerHook = () =>
      Response.json({
        successful: true,
        data: {
          rows: [{ ...ROWS.rows[0], keys: ["x".repeat(2 * 1024 * 1024)] }],
        },
      });
    const large = await read(query());
    expect(large.status).toBe(502);
    expect(await kindOf(large)).toBe("seo_gsc_response_too_large");
    providerHook = () =>
      Response.json({
        successful: true,
        data: {
          ...INSPECTION,
          inspectionResult: {
            ...INSPECTION.inspectionResult,
            debug: { access_token: "ya29.fixture-secret" },
          },
        },
      });
    const leaked = await read(inspect());
    expect(leaked.status).toBe(502);
    expect(await leaked.text()).not.toContain("ya29.fixture-secret");
  });

  it("keeps a durable per-Task budget for each operation", async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      expect((await read(sitesList)).status).toBe(200);
    expect((await read(sitesList)).status).toBe(429);
    expect(reads).toHaveLength(10);
    expect((await read(query())).status).toBe(200);
    const budget = await prisma.projectSeoObservation.findFirstOrThrow({
      where: { auditId, kind: "task_gsc_read_budget" },
    });
    expect(budget).toMatchObject({
      ownerId,
      visibility: "PRIVATE",
      pageIds: [],
      sourceTaskId: null,
      payload: { "sites.list": 10, "searchAnalytics.query": 1 },
    });
  });

  it("imports a report with Search Console sections only for an audit approved with Search Console", async () => {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "COMPLETED" },
    });
    const report = {
      ...siteStrategyReport(),
      searchConsole: { clicks: 3 },
      pages: PAGE_URLS.map((url) => ({
        ...legacyReport(),
        request: { url, connections: ["search_console"] },
        searchConsole: { totals: { clicks: 3 } },
        header: {
          ...legacyReport().header,
          focusKeywords: legacyReport().header.focusKeywords.map((row) => ({
            ...row,
            searchConsole: { desktop: null },
            searchConsoleNote: { desktop: "fewer than 10 impressions" },
          })),
        },
      })),
    };
    const body = JSON.stringify(report);
    const file = await prisma.taskFile.create({
      data: {
        taskId,
        name: `seo-report-${taskId}.json`,
        fileUrl: `https://seo-test.public.blob.vercel-storage.com/tasks/${taskId}/report.json`,
        mimeType: "application/json",
        size: BigInt(Buffer.byteLength(body)),
        uploadedByCoworkerId: coworkerId,
      },
    });
    const owner = {
      owner: { kind: "audit" as const, id: auditId },
      workspaceId,
      organizationId,
      userId: ownerId,
    };
    const input = { taskId, fileId: file.id };
    const fetchImpl = async () => new Response(body);
    await setAccess(null);
    await expect(
      importProjectSeoAudit(owner, input, { fetchImpl }),
    ).rejects.toMatchObject({ status: 400 });
    await setAccess({
      propertyId: PROPERTY,
      connectionVersion: "0".repeat(64),
    });
    const imported = await importProjectSeoAudit(owner, input, { fetchImpl });
    expect(JSON.stringify(imported.payload)).not.toMatch(
      /searchConsole|search_console|impressions/,
    );
  });
});
