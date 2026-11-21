/**
 * Shared PostgreSQL fixture for the Task-scoped Search Console read tests.
 * Each test file keeps its own `vi.mock` calls for auth, Composio and env,
 * and passes its hoisted provider fakes in here.
 */
import { randomUUID } from "node:crypto";
import type { Mock } from "vitest";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";
import mountStatus from "@/routes/v1/tasks/[id]/integrations/search-console/get";
import mount from "@/routes/v1/tasks/[id]/integrations/search-console/reads/post";
import {
  connectionVersion,
  resolveSeoStatisticsIntegration,
} from "@/services/seo-connections.service";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";

export type SearchConsoleReadNetwork = {
  tools: Mock;
  describe: Mock;
  fetch: Mock;
  account: Mock;
};

export const searchConsoleReadsEnabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres") &&
  ["127.0.0.1", "localhost"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  );

export const PAGE_URLS = ["https://example.test/a", "https://example.test/b"];
export const PROPERTY = "sc-domain:example.test";
export const LIST_TOOL = "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
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
export const SITES = {
  siteEntry: [
    { siteUrl: "https://other-client.test/", permissionLevel: "siteOwner" },
    { siteUrl: PROPERTY, permissionLevel: "siteOwner" },
    { siteUrl: "sc-domain:private.test", permissionLevel: "siteFullUser" },
  ],
};
export const ROWS = {
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
export const INSPECTION = {
  inspectionResult: {
    inspectionResultLink: "https://search.google.com/search-console/inspect",
    indexStatusResult: { verdict: "PASS", coverageState: "Submitted" },
  },
};

export function day(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

/** Seeds one owner, organization, vendor and audit, and a RUNNING Task per test. */
export function searchConsoleReadFixture(
  network: SearchConsoleReadNetwork,
  coworkerId: string,
) {
  const ownerId = randomUUID(),
    workspaceId = randomUUID(),
    organizationId = randomUUID(),
    vendorId = randomUUID(),
    otherCoworkerId = randomUUID(),
    auditId = randomUUID();
  const expected = {
    expectedOwnerId: ownerId,
    expectedOrganizationId: organizationId,
  };
  const fx = {
    ownerId,
    workspaceId,
    organizationId,
    vendorId,
    coworkerId,
    otherCoworkerId,
    auditId,
    taskId: "",
    connectionId: "",
    composioAccountId: "",
    actor: { actor: "coworker", coworkerId, vendorId } as AuthenticationContext,
    reads: [] as Array<{ slug: string; input: Record<string, unknown> }>,
    providerHook: undefined as
      | ((slug: string) => Promise<Response | null> | Response | null)
      | undefined,
    expected,
    sitesList: { operation: "sites.list", ...expected },
    query: (extra: Record<string, unknown> = {}) => ({
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
    }),
    inspect: (inspectionUrl = PAGE_URLS[0]) => ({
      operation: "urlInspection.inspect",
      siteUrl: PROPERTY,
      inspectionUrl,
      ...expected,
    }),
    read(body: unknown) {
      return createTaskScheduleTestApp(mount, fx.actor, null).request(
        `http://localhost/${fx.taskId}/integrations/search-console/reads`,
        jsonRequest("POST", body),
      );
    },
    async status() {
      const response = await createTaskScheduleTestApp(
        mountStatus,
        fx.actor,
        null,
      ).request(
        `http://localhost/${fx.taskId}/integrations/search-console`,
        jsonRequest("GET"),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return (await response.json()).data;
    },
    async setAccess(access: unknown) {
      const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
        where: { taskId: fx.taskId },
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
    },
    async kindOf(response: Response) {
      return (await response.json()).kind;
    },
  };

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
    fx.reads = [];
    fx.providerHook = undefined;
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
    fx.taskId = (
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
    fx.composioAccountId = randomUUID();
    fx.connectionId = (
      await prisma.seoConnection.create({
        data: {
          workspaceId,
          userId: ownerId,
          provider: "search_console",
          status: "ACTIVE",
          revision: 1,
          composioAccountId: fx.composioAccountId,
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
        taskId: fx.taskId,
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
    fx.actor = { actor: "coworker", coworkerId, vendorId };
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
        fx.reads.push({ slug, input: JSON.parse(String(options.body)) });
        const overridden = await fx.providerHook?.(slug);
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
  return fx;
}
