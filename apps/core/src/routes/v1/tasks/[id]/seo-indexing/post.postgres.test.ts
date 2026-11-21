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
import {
  assertSeoArtifactMatchesRequest,
  parsePublicSeoArtifact,
} from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  seoTaskIndexingReceiptSchema,
  seoTaskIndexingResultSchema,
} from "@/schemas/seo-task-indexing.schema";
import { getProjectSeoWorkspace } from "@/services/project-seo.service";
import { sha256 } from "@/services/project-seo-store";
import {
  connectionVersion,
  resolveSeoStatisticsIntegration,
} from "@/services/seo-connections.service";
import { legacyReport, siteStrategyReport } from "@/test-fixtures/project-seo";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";
import mountPages from "../seo-pages/post";
import mount from "./post";

const { network } = vi.hoisted(() => ({
  network: { tools: vi.fn(), describe: vi.fn(), fetch: vi.fn() },
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
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres") &&
  ["127.0.0.1", "localhost"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  );
const ownerId = randomUUID(),
  otherOwnerId = randomUUID(),
  workspaceId = randomUUID(),
  otherWorkspaceId = randomUUID();
const organizationId = randomUUID();
const vendorId = randomUUID(),
  coworkerId = randomUUID(),
  otherCoworkerId = randomUUID(),
  auditId = randomUUID();
const PAGE_URLS = ["https://example.test/a", "https://example.test/b"];
const PROPERTY = "sc-domain:example.test";
const LIST_TOOL = "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
  INSPECT_TOOL = "GOOGLE_SEARCH_CONSOLE_INSPECT_URL";
const expectedContext = { ownerId, organizationId, workspaceId };
const createdTaskIds: string[] = [];
const descriptors = [LIST_TOOL, INSPECT_TOOL].map((slug) => ({
  slug,
  name: slug,
  tags: ["readOnlyHint"],
  inputParameters: {
    type: "object",
    properties:
      slug === LIST_TOOL
        ? {}
        : { site_url: { type: "string" }, inspection_url: { type: "string" } },
  },
}));

function assessment(pageUrl: string) {
  return {
    pageUrl,
    status: "review",
    report: false,
    reason: "Confirm whether this page should appear in search",
    suggestedFix: null,
    evidence: ["Google left this URL out"],
  };
}

describe.skipIf(!enabled)("Task-bound SEO indexing on PostgreSQL", () => {
  let taskId: string;
  let connectionId: string;
  let actor: AuthenticationContext;
  let reads: Array<{
    slug: string;
    input: {
      arguments: Record<string, unknown>;
      connected_account_id: string;
      user_id: string;
    };
  }>;
  let providerHook:
    | ((
        slug: string,
        args: Record<string, unknown>,
      ) => Promise<Response | null>)
    | undefined;

  function request(
    result?: { receiptHash: string; assessments: unknown[] },
    extra: Record<string, unknown> = {},
  ) {
    return createTaskScheduleTestApp(mount, actor, null).request(
      `http://localhost/${taskId}/seo-indexing/${result ? "result/" : ""}context-v1`,
      jsonRequest("POST", { expectedContext, ...result, ...extra }),
    );
  }
  async function approveDiscovery(
    pageUrls: string[] = PAGE_URLS,
    searchConsoleAccess?: {
      propertyId: string;
      connectionVersion: string;
    } | null,
  ) {
    const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    const packet = {
      version: 1,
      requestId: analysis.id,
      pageUrls,
      inspectRelated: true,
      price: { kind: "fixed", credits: 750 },
      countryCode: "US",
      languageCode: "en",
    };
    const pages = await prisma.projectSeoPage.findMany({
      where: { auditId, url: { in: pageUrls } },
    });
    await prisma.projectSeoAnalysis.update({
      where: { id: analysis.id },
      data: {
        request: {
          ...packet,
          ...(searchConsoleAccess !== undefined && { searchConsoleAccess }),
        },
        pageIds: pageUrls.map(
          (url) => pages.find((page) => page.url === url)!.id,
        ),
      },
    });
    await prisma.task.update({
      where: { id: taskId },
      data: { description: `seo_audit: ${JSON.stringify(packet)}` },
    });
    return packet;
  }
  function selectPages(
    relatedPageUrls: string[] = ["https://example.test/related"],
    extra: Record<string, unknown> = {},
  ) {
    return createTaskScheduleTestApp(mountPages, actor, null).request(
      `http://localhost/${taskId}/seo-indexing/related-pages/context-v1`,
      jsonRequest("POST", {
        expectedContext,
        seedPageUrls: PAGE_URLS,
        relatedPageUrls,
        ...extra,
      }),
    );
  }
  async function receipt(
    extra: Record<string, unknown> = {},
    retryable?: boolean,
  ) {
    const response = await request(undefined, extra);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (retryable !== undefined)
      expect(response.headers.get("X-SEO-Indexing-Retryable")).toBe(
        String(retryable),
      );
    return seoTaskIndexingReceiptSchema.parse((await response.json()).data);
  }

  async function createPublicAudit() {
    const owner = {
      owner: { kind: "audit" as const, id: auditId },
      workspaceId,
      organizationId,
      userId: ownerId,
    };
    const query = {
      pageIds: (
        await prisma.projectSeoPage.findMany({
          where: { auditId },
          select: { id: true },
        })
      ).map((page) => page.id),
    };
    const publicAudit = await prisma.projectSeoObservation.create({
      data: {
        auditId,
        kind: "audit_full",
        source: "seo_coworker",
        sourceKey: randomUUID(),
        sourceTaskId: taskId,
        pageIds: query.pageIds,
        scopeVersion: 0,
        artifactHash: "public-audit-fixture",
        observedAt: new Date(),
        payload: {
          version: 1,
          kind: "audit_full",
          requestId: null,
          pageUrls: PAGE_URLS,
          observedAt: new Date().toISOString(),
          countryCode: "US",
          languageCode: "en",
          rulebookVersion: "fixture",
          checks: [],
          keywords: [],
          competitors: [],
          findings: [],
          actions: [],
          coverage: { checked: 0, skipped: 0, failed: 0 },
          notes: [],
        },
      },
    });
    return { owner, query, publicAudit };
  }

  beforeAll(async () => {
    for (const [id, ownWorkspace] of [
      [ownerId, workspaceId],
      [otherOwnerId, otherWorkspaceId],
    ])
      await prisma.user.create({
        data: {
          id: id!,
          name: "Indexing bridge fixture",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: ownWorkspace! } },
        },
      });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Indexing bridge workspace",
        slug: organizationId,
        members: {
          create: [ownerId, otherOwnerId].map((userId) => ({
            userId,
            role: "member",
            seatAssignedAt: new Date(),
          })),
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
        name: "Indexing bridge fixture",
        slug: vendorId,
        coworkers: {
          create: [coworkerId, otherCoworkerId].map((id) => ({
            id,
            name: "Indexing fixture worker",
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
        name: "Indexing bridge fixture",
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
    await prisma.seoConnection.deleteMany({ where: { workspaceId } });
    const pages = await Promise.all(
      PAGE_URLS.map((url) =>
        prisma.projectSeoPage.create({ data: { auditId, url } }),
      ),
    );
    const task = await prisma.task.create({
      data: {
        ownerId,
        organizationId,
        workspaceId,
        assigneeId: coworkerId,
        name: "SEO indexing check",
        status: "RUNNING",
      },
    });
    taskId = task.id;
    createdTaskIds.push(taskId);
    await prisma.projectSeoAnalysis.create({
      data: {
        auditId,
        taskId,
        requestedBy: ownerId,
        kind: "audit_full",
        requestHash: "fixture-request-hash",
        idempotencyKey: randomUUID(),
        pageIds: pages.map((page) => page.id),
        request: { pageUrls: PAGE_URLS, countryCode: "US", languageCode: "en" },
      },
    });
    connectionId = (
      await prisma.seoConnection.create({
        data: {
          workspaceId,
          userId: ownerId,
          provider: "search_console",
          status: "ACTIVE",
          revision: 1,
          composioAccountId: randomUUID(),
          entityId: "fixture-owner-search-console",
        },
      })
    ).id;
    actor = { actor: "coworker", coworkerId, vendorId };
    network.tools.mockResolvedValue(descriptors);
    network.describe.mockImplementation(async (slug: string) =>
      descriptors.find((tool) => tool.slug === slug),
    );
    network.fetch.mockImplementation(
      async (url: string, options: RequestInit) => {
        const slug = decodeURIComponent(
          new URL(url).pathname.split("/").at(-1)!,
        );
        if (![LIST_TOOL, INSPECT_TOOL].includes(slug))
          throw new Error(
            "Unexpected provider operation in the indexing fixture",
          );
        const input = JSON.parse(String(options.body));
        reads.push({ slug, input });
        const overridden = await providerHook?.(slug, input.arguments);
        if (overridden) return overridden;
        const data =
          slug === LIST_TOOL
            ? {
                siteEntry: [
                  { siteUrl: PROPERTY, permissionLevel: "siteOwner" },
                ],
              }
            : {
                inspectionResult: {
                  indexStatusResult: {
                    verdict: "NEUTRAL",
                    coverageState: "Crawled - currently not indexed",
                    indexingState: "INDEXING_ALLOWED",
                    pageFetchState: "SUCCESSFUL",
                  },
                },
              };
        return Response.json({ successful: true, data });
      },
    );
    vi.stubGlobal("fetch", network.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  afterAll(async () => {
    await prisma.lock.deleteMany({
      where: {
        OR: createdTaskIds.map((id) => ({
          key: { startsWith: `seo-task-indexing:${id}:` },
        })),
      },
    });
    await prisma.vendorGrant.deleteMany({ where: { vendorId } });
    await prisma.task.deleteMany({ where: { ownerId } });
    await prisma.seoAudit.deleteMany({ where: { id: auditId } });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.coworker.deleteMany({ where: { vendorId } });
    await prisma.vendor.delete({ where: { id: vendorId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, otherOwnerId] } },
    });
  });

  it("freezes and replays a www target only for the approved domain property", async () => {
    const related = "https://www.example.test/guide";
    const integration = await resolveSeoStatisticsIntegration(
      { userId: ownerId, workspaceId },
      "search_console",
    );
    expect.assert(integration);
    const proof = {
      propertyId: PROPERTY,
      connectionVersion: connectionVersion(integration),
    };
    await approveDiscovery(PAGE_URLS, {
      ...proof,
      propertyId: "https://example.test/",
    });
    expect((await selectPages([related])).status).toBe(400);
    const original = await approveDiscovery(PAGE_URLS, proof);
    for (const proposals of [[related], []]) {
      const response = await selectPages(proposals);
      expect(response.status, await response.clone().text()).toBe(200);
      expect((await response.json()).data.inspectionPageUrls).toEqual([
        ...PAGE_URLS,
        related,
      ]);
    }
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: taskId } }))
        .description,
    ).toBe("seo_audit: " + JSON.stringify(original));
  });

  it("resumes deferred public leads only for a new audit with the same owner, page scope and workspace", async () => {
    const lead = "https://example.test/article";
    const priorPacket = await approveDiscovery(PAGE_URLS);
    const deferred = () =>
      createTaskScheduleTestApp(mountPages, actor, null).request(
        `http://localhost/${taskId}/seo-indexing/deferred/context-v1`,
        jsonRequest("POST", { expectedContext }),
      );
    const siteEvidence = {
      version: 1,
      complete: true,
      sampledPages: [PAGE_URLS[0]],
      observations: [],
      responses: PAGE_URLS.map((pageUrl) => ({ pageUrl, status: 200 })),
      coverage: {
        discovered: 3,
        deferredCount: 1,
        deferred: [{ url: lead, reason: "page_limit" }],
      },
    };
    const forged = await selectPages([], {
      siteEvidence: {
        ...siteEvidence,
        coverage: {
          ...siteEvidence.coverage,
          deferred: [
            { url: "https://foreign.test/private", reason: "page_limit" },
          ],
        },
      },
    });
    expect(forged.status).toBe(400);
    expect((await selectPages([], { siteEvidence })).status).toBe(200);
    expect((await (await deferred()).json()).data.urls).toEqual([]);
    const priorTaskId = taskId;
    const prior = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    const next = await prisma.task.create({
      data: {
        ownerId,
        organizationId,
        workspaceId,
        assigneeId: coworkerId,
        name: "Second indexing check",
        status: "RUNNING",
        description: `seo_audit: ${JSON.stringify(priorPacket)}`,
      },
    });
    taskId = next.id;
    createdTaskIds.push(taskId);
    const nextAnalysis = await prisma.projectSeoAnalysis.create({
      data: {
        auditId,
        taskId,
        requestedBy: ownerId,
        kind: "audit_full",
        requestHash: "second",
        idempotencyKey: randomUUID(),
        pageIds: prior.pageIds,
        request: priorPacket,
      },
    });
    const resumed = await deferred();
    expect(resumed.status, await resumed.clone().text()).toBe(200);
    expect((await resumed.json()).data.urls).toEqual([lead]);
    const where = { sourceTaskId: priorTaskId, kind: "site_evidence" };
    await prisma.projectSeoObservation.updateMany({
      where,
      data: { ownerId: otherOwnerId },
    });
    expect((await (await deferred()).json()).data.urls).toEqual([]);
    await prisma.projectSeoObservation.updateMany({
      where,
      data: { ownerId, visibility: "SHARED" },
    });
    expect((await (await deferred()).json()).data.urls).toEqual([]);
    await prisma.projectSeoObservation.updateMany({
      where,
      data: { visibility: "PRIVATE" },
    });
    const otherWorkspace = await createTaskScheduleTestApp(
      mountPages,
      actor,
      null,
    ).request(
      `http://localhost/${taskId}/seo-indexing/deferred/context-v1`,
      jsonRequest("POST", {
        expectedContext: { ...expectedContext, workspaceId: otherWorkspaceId },
      }),
    );
    expect(otherWorkspace.status).toBeGreaterThanOrEqual(400);
    await prisma.projectSeoAnalysis.update({
      where: { id: nextAnalysis.id },
      data: { scopeVersion: 1 },
    });
    expect((await (await deferred()).json()).data.urls).toEqual([]);
  });

  it("keeps the connected property's Google examples for the exact dynamic target outside the worker receipt", async () => {
    const target = "https://example.test/guide",
      referring = "https://example.test/library",
      sitemap = "https://example.test/sitemap.xml";
    const integration = await resolveSeoStatisticsIntegration(
      { userId: ownerId, workspaceId },
      "search_console",
    );
    expect.assert(integration);
    await approveDiscovery(PAGE_URLS, {
      propertyId: PROPERTY,
      connectionVersion: connectionVersion(integration),
    });
    expect(
      (
        await selectPages([target], {
          siteEvidence: {
            version: 1,
            sampledPages: [],
            observations: [],
            complete: false,
          },
        })
      ).status,
    ).toBe(200);
    providerHook = async (slug, args) =>
      slug === INSPECT_TOOL && args.inspection_url === target
        ? Response.json({
            successful: true,
            data: {
              inspectionResult: {
                indexStatusResult: {
                  verdict: "NEUTRAL",
                  coverageState: "Crawled - currently not indexed",
                  referringUrls: [
                    referring,
                    "https://foreign.test/",
                    "https://example.test/login",
                    "https://example.test/reset-password/customer",
                    "https://example.test/users/someone%40example.com",
                    "https://example.test/invite/6bba1b36-ac42-4571-b7cf-72d353044572",
                  ],
                  sitemap: [
                    sitemap,
                    "https://example.test/map.xml?token=secret",
                  ],
                },
              },
            },
          })
        : null;
    const worker = await request();
    expect(worker.status).toBe(200);
    const wire = await worker.text();
    expect(wire).not.toContain(referring);
    expect(wire).not.toContain(sitemap);
    expect(
      reads.filter(
        (read) =>
          read.slug === INSPECT_TOOL &&
          read.input.arguments.inspection_url === target,
      ),
    ).toHaveLength(1);
    const { owner, query } = await createPublicAudit();
    const workspace = await getProjectSeoWorkspace(owner, query);
    const named = workspace.siteEvidence?.targets.find(
      (item) => item.targetUrl === target,
    );
    expect(named).toMatchObject({
      googleReferringPages: [referring],
      googleSitemapUrls: [sitemap],
      donorUrls: [],
      sitemapUrls: [],
    });
    expect(
      workspace.siteEvidence?.targets[0]?.googleReferringPages,
    ).toBeUndefined();
    expect(
      (
        await getProjectSeoWorkspace(owner, query, {
          includePrivateIndexing: false,
        })
      ).siteEvidence,
    ).toBeNull();
  });

  it.each([null, "https://example.test/"])(
    "retains a public redirect sample once without granting its alias a Google inspection for %s",
    async (propertyId) => {
      const integration = await resolveSeoStatisticsIntegration(
        { userId: ownerId, workspaceId },
        "search_console",
      );
      expect.assert(integration);
      await approveDiscovery(
        PAGE_URLS,
        propertyId
          ? { propertyId, connectionVersion: connectionVersion(integration) }
          : null,
      );
      const target = "https://www.example.test/lesson";
      const donor = "https://www.example.test/library";
      const siteEvidence = {
        version: 1,
        sampledPages: [donor],
        complete: true,
        observations: [
          {
            sourceUrl: donor,
            targetUrl: target,
            sourceKind: "link",
            location: "content",
          },
        ],
        responses: [
          { pageUrl: PAGE_URLS[0], status: 301, finalUrl: donor },
          { pageUrl: target, status: 410 },
        ],
      };
      const first = await selectPages([target], { siteEvidence });
      expect(first.status, await first.clone().text()).toBe(200);
      expect((await first.json()).data.inspectionPageUrls).toEqual(PAGE_URLS);
      const replay = await selectPages([], {
        siteEvidence: { ...siteEvidence, observations: [] },
      });
      expect(replay.status).toBe(200);
      const rows = await prisma.projectSeoObservation.findMany({
        where: { sourceTaskId: taskId, kind: "site_evidence" },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ownerId,
        visibility: "PRIVATE",
        payload: { targetUrls: [...PAGE_URLS, target], evidence: siteEvidence },
      });
      await createPublicAudit();
      const actor = {
        userId: ownerId,
        organizationId,
        workspaceId,
        owner: { kind: "audit" as const, id: auditId },
      };
      expect(
        (await getProjectSeoWorkspace(actor)).siteEvidence?.targets.at(-1),
      ).toMatchObject({
        targetUrl: target,
        status: "fix_link",
        donorUrls: [donor],
      });
      expect(
        (
          await getProjectSeoWorkspace(
            actor,
            {},
            { includePrivateIndexing: false },
          )
        ).siteEvidence,
      ).toBeNull();
    },
  );

  it("freezes related indexing evidence without adding saved pages or widening the report", async () => {
    const original = await approveDiscovery();
    const before = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    const first = await selectPages();
    expect(first.status, await first.clone().text()).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const inspectionPageUrls = [...PAGE_URLS, "https://example.test/related"];
    expect((await first.json()).data).toEqual({
      version: 1,
      taskId,
      auditPageUrl: PAGE_URLS[0],
      inspectionPageUrls,
    });
    const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    expect(analysis.pageIds).toEqual(before.pageIds);
    expect(analysis.request).toMatchObject({
      pageUrls: PAGE_URLS,
      relatedIndexingSelection: {
        version: 1,
        seedPageUrls: PAGE_URLS,
        relatedPageUrls: [inspectionPageUrls[2]],
      },
    });
    expect(await prisma.projectSeoPage.count({ where: { auditId } })).toBe(
      PAGE_URLS.length,
    );
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: taskId } }))
        .description,
    ).toBe(`seo_audit: ${JSON.stringify(original)}`);
    const retry = await selectPages(["https://example.test/other"]);
    expect(retry.status).toBe(200);
    expect((await retry.json()).data.inspectionPageUrls).toEqual(
      inspectionPageUrls,
    );
    const raw = {
      ...siteStrategyReport(),
      pages: PAGE_URLS.map((url) => ({
        ...legacyReport(),
        request: { ...legacyReport().request, url },
      })),
    };
    const payload = parsePublicSeoArtifact(raw);
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, payload, analysis),
    ).not.toThrow();
    expect(() =>
      assertSeoArtifactMatchesRequest(
        raw,
        { ...payload, pageUrls: inspectionPageUrls },
        analysis,
      ),
    ).toThrow("frozen page scope");
    expect(reads).toEqual([]);
    const inspected = await receipt();
    expect(inspected.auditPageUrl).toBe(PAGE_URLS[0]);
    expect(inspected.pages.map((page) => page.pageUrl)).toEqual(
      inspectionPageUrls,
    );
    const written = await request({
      receiptHash: inspected.receiptHash,
      assessments: inspectionPageUrls.map(assessment),
    });
    expect(written.status, await written.clone().text()).toBe(200);
    const stored = await prisma.projectSeoObservation.findFirstOrThrow({
      where: { auditId, kind: "index_triage" },
    });
    expect(stored.pageIds).toEqual(before.pageIds);
    expect(stored.payload).toMatchObject({ auditPageUrl: PAGE_URLS[0] });
  });

  it("keeps an explicitly limited audit private through related-page discovery and skips Google", async () => {
    const packet = await approveDiscovery(PAGE_URLS, null);
    expect((await selectPages()).status).toBe(200);
    const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    expect(analysis.request).toHaveProperty("searchConsoleAccess", null);
    expect((await receipt({}, false)).status).toBe("unavailable");
    expect(reads).toEqual([]);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: taskId } }))
        .description,
    ).toBe(`seo_audit: ${JSON.stringify(packet)}`);
  });

  it("keeps one member's account private across two project audits and refuses a moved Task", async () => {
    const ownerAccount = await prisma.seoConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    const otherAccount = await prisma.seoConnection.create({
      data: {
        workspaceId,
        userId: otherOwnerId,
        provider: "search_console",
        status: "ACTIVE",
        composioAccountId: randomUUID(),
        entityId: randomUUID(),
      },
    });
    const projects = await Promise.all(
      ["First", "Second"].map((name) =>
        prisma.project.create({ data: { workspaceId, name } }),
      ),
    );
    const integration = await resolveSeoStatisticsIntegration(
      { userId: ownerId, workspaceId },
      "search_console",
    );
    expect.assert(integration);
    const proof = {
      propertyId: PROPERTY,
      connectionVersion: connectionVersion(integration),
    };
    const firstTaskId = taskId;
    const secondAudit = await prisma.seoAudit.create({
      data: {
        workspaceId,
        name: "Second project audit",
        createdById: otherOwnerId,
        projectId: projects[1]!.id,
      },
    });
    try {
      await prisma.seoAudit.update({
        where: { id: auditId },
        data: { projectId: projects[0]!.id },
      });
      await prisma.task.update({
        where: { id: taskId },
        data: { projectId: projects[0]!.id },
      });
      await approveDiscovery(PAGE_URLS, proof);
      expect((await selectPages([])).status).toBe(200);
      expect((await receipt()).status).toBe("available");
      const pages = await Promise.all(
        PAGE_URLS.map((url) =>
          prisma.projectSeoPage.create({
            data: { auditId: secondAudit.id, url },
          }),
        ),
      );
      const secondTask = await prisma.task.create({
        data: {
          workspaceId,
          organizationId,
          ownerId,
          assigneeId: coworkerId,
          projectId: projects[1]!.id,
          name: "Second project audit",
          status: "RUNNING",
        },
      });
      taskId = secondTask.id;
      createdTaskIds.push(taskId);
      await prisma.projectSeoAnalysis.create({
        data: {
          auditId: secondAudit.id,
          taskId,
          requestedBy: ownerId,
          kind: "audit_full",
          requestHash: "second-project",
          idempotencyKey: randomUUID(),
          pageIds: pages.map((p) => p.id),
          request: { pageUrls: PAGE_URLS, searchConsoleAccess: proof },
        },
      });
      const secondReceipt = await receipt();
      expect(secondReceipt.pages[0]?.indexingState).toBe("INDEXING_ALLOWED");
      expect(reads.filter((read) => read.slug === INSPECT_TOOL)).toHaveLength(
        PAGE_URLS.length * 2,
      );
      expect(
        reads.every(
          (read) =>
            read.input.connected_account_id === ownerAccount.composioAccountId,
        ),
      ).toBe(true);
      expect(JSON.stringify(secondReceipt)).not.toContain(
        ownerAccount.composioAccountId,
      );
      expect(
        await prisma.seoConnection.findUnique({
          where: { id: otherAccount.id },
        }),
      ).toEqual(otherAccount);
      await prisma.task.update({
        where: { id: taskId },
        data: { projectId: projects[0]!.id },
      });
      const before = reads.length;
      expect((await request()).status).toBe(409);
      expect(reads).toHaveLength(before);
      await prisma.task.update({
        where: { id: taskId },
        data: { projectId: projects[1]!.id },
      });
      await prisma.seoConnection.delete({ where: { id: connectionId } });
      expect((await receipt()).status).toBe("unavailable");
      expect(reads).toHaveLength(before);
    } finally {
      taskId = firstTaskId;
      await prisma.seoAudit.delete({ where: { id: secondAudit.id } });
      await prisma.project.deleteMany({
        where: { id: { in: projects.map((p) => p.id) } },
      });
    }
  });

  it("uses only the approved account and property even after a cached inspection", async () => {
    const owner = { userId: ownerId, workspaceId };
    const integration = await resolveSeoStatisticsIntegration(
      owner,
      "search_console",
    );
    expect.assert(integration);
    const access = {
      propertyId: PROPERTY,
      connectionVersion: connectionVersion(integration),
    };
    await approveDiscovery(PAGE_URLS, access);
    expect((await selectPages()).status).toBe(200);
    const first = await receipt({}, false);
    expect(first.status).toBe("available");
    const inspected = reads.filter((read) => read.slug === INSPECT_TOOL).length;
    providerHook = async (slug) =>
      slug === LIST_TOOL
        ? Response.json({
            successful: true,
            data: {
              siteEntry: [
                {
                  siteUrl: "https://example.test/",
                  permissionLevel: "siteFullUser",
                },
              ],
            },
          })
        : null;
    const denied = await receipt({}, false);
    expect(denied.status).toBe("needs_property");
    expect(
      denied.pages.every((page) => page.verdict === "VERDICT_UNSPECIFIED"),
    ).toBe(true);
    expect(reads.filter((read) => read.slug === INSPECT_TOOL)).toHaveLength(
      inspected,
    );
    await prisma.seoConnection.update({
      where: { id: connectionId },
      data: { revision: { increment: 1 } },
    });
    const previousReadCount = reads.length;
    const changed = await receipt({}, false);
    expect(changed.status).toBe("unavailable");
    expect(reads).toHaveLength(previousReadCount);
    expect(
      (
        await request({
          receiptHash: first.receiptHash,
          assessments: first.pages.map((page) => assessment(page.pageUrl)),
        })
      ).status,
    ).toBe(409);
  });

  it("binds related findings to a successful original seed when the primary was skipped", async () => {
    await approveDiscovery();
    expect((await selectPages()).status).toBe(200);
    const before = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    const auditPageUrl = PAGE_URLS[1]!;
    const inspected = await receipt({ auditPageUrl });
    expect(inspected.auditPageUrl).toBe(auditPageUrl);
    const result = {
      receiptHash: inspected.receiptHash,
      assessments: inspected.pages.map((page) => ({
        ...assessment(page.pageUrl),
        status: "issue",
        report: true,
        suggestedFix: "Review the canonical and internal links for this page.",
      })),
    };
    expect((await request(result, { auditPageUrl })).status).toBe(200);
    const stored = await prisma.projectSeoObservation.findFirstOrThrow({
      where: { auditId, kind: "index_triage" },
    });
    expect(stored.payload).toMatchObject({ auditPageUrl });
    // The full report contains only its successful seed. Its skipped primary has no public page result.
    const publicAudit = await prisma.projectSeoObservation.create({
      data: {
        auditId,
        kind: "audit_full",
        source: "seo_coworker",
        sourceKey: randomUUID(),
        sourceTaskId: taskId,
        pageIds: before.pageIds,
        scopeVersion: before.scopeVersion,
        artifactHash: "skipped-primary-audit-fixture",
        observedAt: new Date(),
        payload: {
          version: 1,
          kind: "audit_full",
          requestId: null,
          pageUrls: [auditPageUrl],
          observedAt: new Date().toISOString(),
          countryCode: "US",
          languageCode: "en",
          rulebookVersion: "fixture",
          checks: [],
          keywords: [],
          competitors: [],
          findings: [],
          actions: [],
          coverage: { checked: 0, skipped: 1, failed: 0 },
          notes: [],
        },
      },
    });
    const view = await getProjectSeoWorkspace(
      {
        owner: { kind: "audit", id: auditId },
        workspaceId,
        organizationId,
        userId: ownerId,
      },
      { pageIds: before.pageIds },
    );
    expect(view.findings).toContainEqual(
      expect.objectContaining({
        observationId: publicAudit.id,
        pageUrl: auditPageUrl,
        relatedPageUrl: "https://example.test/related",
      }),
    );
    expect((await receipt({ auditPageUrl })).assessmentSaved).toBe(true);
    // Omitting the chosen parent selects the legacy primary context, not this receipt.
    expect((await request(result)).status).toBe(409);
    const primary = await receipt();
    expect(primary.auditPageUrl).toBe(PAGE_URLS[0]);
    expect(primary.receiptHash).not.toBe(inspected.receiptHash);
    expect(primary.assessmentSaved).toBeUndefined();
    expect(await prisma.projectSeoPage.count({ where: { auditId } })).toBe(
      PAGE_URLS.length,
    );
    const after = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    expect(after.pageIds).toEqual(before.pageIds);
    expect(after.request).toEqual(before.request);
  });

  it("rejects forged read and result parents before any provider read", async () => {
    const auditPageUrl = "https://example.test/not-approved";
    expect((await request(undefined, { auditPageUrl })).status).toBe(422);
    expect(
      (
        await request(
          {
            receiptHash: "0".repeat(64),
            assessments: PAGE_URLS.map(assessment),
          },
          { auditPageUrl },
        )
      ).status,
    ).toBe(422);
    expect(reads).toEqual([]);
  });

  it("does not reuse a cached receipt with a different audit parent", async () => {
    const auditPageUrl = PAGE_URLS[1]!;
    const inspected = await receipt({ auditPageUrl });
    const cached = await prisma.projectSeoObservation.findFirstOrThrow({
      where: { auditId, kind: "index_inspection" },
    });
    await prisma.projectSeoObservation.update({
      where: { id: cached.id },
      data: {
        payload: {
          ...(cached.payload as object),
          receipt: { ...inspected, auditPageUrl: PAGE_URLS[0] },
        },
      },
    });
    const readCount = reads.filter((read) => read.slug === INSPECT_TOOL).length;
    const retried = await receipt({ auditPageUrl });
    expect(retried.auditPageUrl).toBe(auditPageUrl);
    expect(reads.filter((read) => read.slug === INSPECT_TOOL)).toHaveLength(
      readCount + PAGE_URLS.length,
    );
  });

  it("keeps the first committed indexing evidence list when discovery races", async () => {
    await approveDiscovery();
    const responses = await Promise.all([
      selectPages(["https://example.test/race-one"]),
      selectPages(["https://example.test/race-two"]),
    ]);
    for (const response of responses)
      expect(response.status, await response.clone().text()).toBe(200);
    const bodies = await Promise.all(
      responses.map((response) => response.json()),
    );
    expect(bodies[0].data.inspectionPageUrls).toEqual(
      bodies[1].data.inspectionPageUrls,
    );
    expect(bodies[0].data.inspectionPageUrls).toHaveLength(3);
    expect(await prisma.projectSeoPage.count({ where: { auditId } })).toBe(
      PAGE_URLS.length,
    );
    expect(reads).toEqual([]);
  });

  it("rejects foreign, private and oversized evidence without changing approved pages", async () => {
    await approveDiscovery();
    for (const candidates of [
      ["https://other.test/a"],
      ["https://example.test/account"],
      Array.from(
        { length: 9 },
        (_, index) => `https://example.test/extra-${index}`,
      ),
    ]) {
      expect((await selectPages(candidates)).status).toBe(400);
    }
    expect(
      (await selectPages([], { seedPageUrls: [PAGE_URLS[0]] })).status,
    ).toBe(409);
    expect(
      (await prisma.projectSeoAnalysis.findUniqueOrThrow({ where: { taskId } }))
        .pageIds,
    ).toHaveLength(2);
    expect(await prisma.projectSeoPage.count({ where: { auditId } })).toBe(
      PAGE_URLS.length,
    );
    expect(reads).toEqual([]);
  });

  it("requires current Task authority and unchanged original input for related indexing", async () => {
    await approveDiscovery();
    actor = { actor: "coworker", coworkerId: otherCoworkerId, vendorId };
    expect((await selectPages()).status).toBe(403);
    actor = { actor: "coworker", coworkerId, vendorId };
    expect(
      (
        await selectPages([], {
          expectedContext: {
            ...expectedContext,
            workspaceId: otherWorkspaceId,
          },
        })
      ).status,
    ).toBe(409);
    await prisma.task.update({
      where: { id: taskId },
      data: { description: "changed audit" },
    });
    expect((await selectPages()).status).toBe(409);
    await approveDiscovery();
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "COMPLETED" },
    });
    expect((await selectPages()).status).toBe(409);
    expect(reads).toEqual([]);
  });

  it("requires the related target list before inspecting a new opted-in audit", async () => {
    await approveDiscovery();
    expect((await request()).status).toBe(409);
    expect(reads).toEqual([]);
    expect((await selectPages([])).status).toBe(200);
    expect((await receipt()).pages.map((page) => page.pageUrl)).toEqual(
      PAGE_URLS,
    );
    expect(await prisma.projectSeoPage.count({ where: { auditId } })).toBe(
      PAGE_URLS.length,
    );
  });

  it("keeps the primary inspection working when a related URL is outside its selected property", async () => {
    await approveDiscovery([PAGE_URLS[1]!]);
    expect(
      (
        await selectPages(["https://example.test/outside"], {
          seedPageUrls: [PAGE_URLS[1]!],
        })
      ).status,
    ).toBe(200);
    providerHook = async (slug) =>
      slug === LIST_TOOL
        ? Response.json({
            successful: true,
            data: {
              siteEntry: [
                { siteUrl: PAGE_URLS[1]!, permissionLevel: "siteOwner" },
              ],
            },
          })
        : null;
    const inspected = await receipt({}, false);
    expect(inspected.status).toBe("available");
    expect(
      inspected.pages.find(
        (page) => page.pageUrl === "https://example.test/outside",
      )?.verdict,
    ).toBe("VERDICT_UNSPECIFIED");
    expect(
      reads
        .filter((read) => read.slug === INSPECT_TOOL)
        .map((read) => read.input.arguments.inspection_url),
    ).toEqual([PAGE_URLS[1]]);
  });

  it("recovers only the approved seeds after completion when no related selection arrived", async () => {
    await approveDiscovery([PAGE_URLS[1]!]);
    expect((await request()).status).toBe(409);
    expect(reads).toHaveLength(0);
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "COMPLETED" },
    });
    const saved = await receipt();
    expect(saved.pages.map((page) => page.pageUrl)).toEqual([PAGE_URLS[1]]);
    expect(
      reads
        .filter((read) => read.slug === INSPECT_TOOL)
        .map((read) => read.input.arguments.inspection_url),
    ).toEqual([PAGE_URLS[1]]);
    expect((await selectPages(["https://example.test/late"])).status).toBe(409);
  });

  it("keeps saved related children outside an explicitly selected primary page", async () => {
    const primary = await prisma.projectSeoPage.findFirstOrThrow({
      where: { auditId, url: PAGE_URLS[0] },
    });
    const child = await prisma.projectSeoPage.create({
      data: {
        auditId,
        url: "https://example.test/saved-child",
        relationship: "related",
        relatedToPageId: primary.id,
      },
    });
    const viewer = {
      userId: ownerId,
      organizationId,
      workspaceId,
      owner: { kind: "audit" as const, id: auditId },
    };
    expect(
      (await getProjectSeoWorkspace(viewer, { pageId: primary.id })).scope
        .pageIds,
    ).toEqual([primary.id]);
    expect(
      (await getProjectSeoWorkspace(viewer, { pageId: child.id })).scope
        .pageIds,
    ).toEqual([child.id]);
    expect(
      (await getProjectSeoWorkspace(viewer, { pageIds: [primary.id] })).scope
        .pageIds,
    ).toEqual([primary.id]);
  });

  it("reads exactly the approved primary and related pages, caches inspections, and saves only private results", async () => {
    const first = await receipt();
    expect(first.pages.map((page) => page.pageUrl)).toEqual(PAGE_URLS);
    expect(first.pages[0]?.indexingState).toBe("INDEXING_ALLOWED");
    expect(
      reads
        .filter((read) => read.slug === INSPECT_TOOL)
        .map((read) => read.input.arguments),
    ).toEqual(
      PAGE_URLS.map((pageUrl) => ({
        site_url: PROPERTY,
        inspection_url: pageUrl,
      })),
    );
    expect(
      reads.every((read) => [LIST_TOOL, INSPECT_TOOL].includes(read.slug)),
    ).toBe(true);
    expect(
      reads.every(
        (read) => read.input.user_id === "fixture-owner-search-console",
      ),
    ).toBe(true);
    expect((await receipt()).receiptHash).toBe(first.receiptHash);
    expect(reads.filter((read) => read.slug === INSPECT_TOOL)).toHaveLength(
      PAGE_URLS.length,
    );
    const input = {
      receiptHash: first.receiptHash,
      assessments: PAGE_URLS.map(assessment),
    };
    const response = await request(input);
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json()).data).toEqual({
      version: 1,
      taskId,
      receiptHash: first.receiptHash,
    });
    expect((await request(input)).status).toBe(200);
    const retryReceipt = await receipt();
    expect(retryReceipt.receiptHash).toBe(first.receiptHash);
    expect(retryReceipt.assessmentSaved).toBe(true);
    const storedInspection =
      await prisma.projectSeoObservation.findFirstOrThrow({
        where: { auditId, kind: "index_inspection" },
      });
    expect(storedInspection.payload).not.toHaveProperty(
      "receipt.assessmentSaved",
    );
    const saved = await prisma.projectSeoObservation.findMany({
      where: { auditId },
    });
    expect(
      saved.map((row) => [row.kind, row.visibility, row.ownerId]).sort(),
    ).toEqual([
      ["index_inspection", "PRIVATE", ownerId],
      ["index_triage", "PRIVATE", ownerId],
    ]);
    expect(await prisma.taskFile.count({ where: { taskId } })).toBe(0);
    expect(await prisma.taskEvent.count({ where: { taskId } })).toBe(0);
    const changed = {
      ...input,
      assessments: PAGE_URLS.map((pageUrl) => ({
        ...assessment(pageUrl),
        reason: "A different assessment",
      })),
    };
    expect((await request(changed)).status).toBe(409);
  });

  it.each(["foreign owner", "old receipt", "invalid artifact"])(
    "does not acknowledge a saved assessment for %s",
    async (changed) => {
      const first = await receipt();
      expect(first.assessmentSaved).toBeUndefined();
      expect(
        (
          await request({
            receiptHash: first.receiptHash,
            assessments: PAGE_URLS.map(assessment),
          })
        ).status,
      ).toBe(200);
      const row = await prisma.projectSeoObservation.findFirstOrThrow({
        where: { auditId, kind: "index_triage" },
      });
      await prisma.projectSeoObservation.update({
        where: { id: row.id },
        data:
          changed === "foreign owner"
            ? { ownerId: otherOwnerId }
            : changed === "old receipt"
              ? { sourceKey: `task-index-triage:${taskId}:${"0".repeat(64)}` }
              : { artifactHash: "0".repeat(64) },
      });
      const retryReceipt = await receipt();
      expect(retryReceipt.receiptHash).toBe(first.receiptHash);
      expect(retryReceipt.assessmentSaved).toBeUndefined();
    },
  );

  it("rejects caller-selected URLs, properties, and tenant bindings before a provider read", async () => {
    for (const extra of [
      { pageUrls: ["https://other.test/"] },
      { propertyId: "sc-domain:other.test" },
      { operation: "queries" },
    ])
      expect((await request(undefined, extra)).status).toBe(422);
    expect(
      (
        await request(undefined, {
          expectedContext: {
            ...expectedContext,
            workspaceId: otherWorkspaceId,
          },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(undefined, {
          expectedContext: { ...expectedContext, ownerId: otherOwnerId },
        })
      ).status,
    ).toBe(409);
    expect(reads).toEqual([]);
  });

  it("requires the assigned bare Coworker key and an active audit Task", async () => {
    actor = {
      actor: "user",
      userId: ownerId,
      organizationId: null,
      role: "user",
    };
    expect((await request()).status).toBe(403);
    actor = {
      actor: "coworker",
      coworkerId,
      vendorId,
      context: { userId: ownerId, organizationId: null },
    };
    expect((await request()).status).toBe(403);
    actor = { actor: "coworker", coworkerId: otherCoworkerId, vendorId };
    expect((await request()).status).toBe(403);
    actor = { actor: "coworker", coworkerId, vendorId };
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "READY" },
    });
    expect((await request()).status).toBe(409);
    expect(reads).toEqual([]);
  });

  it.each(["DENIED", "REVOKED"] as const)(
    "honors explicit %s Vendor refusal before reading Google",
    async (status) => {
      await prisma.vendorGrant.create({
        data: { vendorId, workspaceId, status, permission: "workspace" },
      });
      expect((await request()).status).toBe(403);
      expect(reads).toEqual([]);
    },
  );

  it("does not expose an inspection after its Task is reassigned during the provider call", async () => {
    providerHook = async (slug) => {
      if (slug === INSPECT_TOOL)
        await prisma.task.update({
          where: { id: taskId },
          data: { assigneeId: otherCoworkerId },
        });
      return null;
    };
    expect((await request()).status).toBe(403);
    expect(
      await prisma.projectSeoObservation.count({ where: { auditId } }),
    ).toBe(0);
  });

  it("does not expose an inspection after its Google connection changes during collection", async () => {
    providerHook = async (slug) => {
      if (slug === INSPECT_TOOL)
        await prisma.seoConnection.update({
          where: { id: connectionId },
          data: { status: "DISCONNECTED", revision: { increment: 1 } },
        });
      return null;
    };
    expect((await request()).status).toBe(409);
    expect(
      await prisma.projectSeoObservation.count({ where: { auditId } }),
    ).toBe(0);
  });

  it("refuses stale, foreign, missing-page and duplicate-page assessments", async () => {
    const first = await receipt();
    expect(
      (
        await request({
          receiptHash: "0".repeat(64),
          assessments: PAGE_URLS.map(assessment),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request({
          receiptHash: first.receiptHash,
          assessments: [assessment(PAGE_URLS[0]!)],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request({
          receiptHash: first.receiptHash,
          assessments: [assessment(PAGE_URLS[0]!), assessment(PAGE_URLS[0]!)],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request({
          receiptHash: first.receiptHash,
          assessments: [
            assessment(PAGE_URLS[0]!),
            assessment("https://other.test/"),
          ],
        })
      ).status,
    ).toBe(422);
    await prisma.seoConnection.update({
      where: { id: connectionId },
      data: { status: "DISCONNECTED", revision: { increment: 1 } },
    });
    expect(
      (
        await request({
          receiptHash: first.receiptHash,
          assessments: PAGE_URLS.map(assessment),
        })
      ).status,
    ).toBe(409);
    expect(
      await prisma.projectSeoObservation.count({
        where: { auditId, kind: "index_triage" },
      }),
    ).toBe(0);
  });

  it("keeps a failed URL explicitly unknown and rejects a guessed issue for it", async () => {
    providerHook = async (slug, args) =>
      slug === INSPECT_TOOL && args.inspection_url === PAGE_URLS[1]
        ? Response.json(
            { successful: false, error: "private upstream detail" },
            { status: 500 },
          )
        : null;
    const first = await receipt({}, true);
    expect(first.status).toBe("available");
    expect(
      (await request()).headers.get("X-SEO-Indexing-Public-Evidence"),
    ).toBe("1");
    expect(first.pages[1]?.verdict).toBe("VERDICT_UNSPECIFIED");
    expect(JSON.stringify(first)).not.toContain("private upstream detail");
    expect(
      (
        await request({
          receiptHash: first.receiptHash,
          assessments: PAGE_URLS.map(assessment),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request({
          receiptHash: first.receiptHash,
          assessments: [
            assessment(PAGE_URLS[0]!),
            { ...assessment(PAGE_URLS[1]!), status: "unavailable" },
          ],
        })
      ).status,
    ).toBe(200);
  });

  it("carries the retry signal through a saved partial assessment until Google recovers", async () => {
    providerHook = async (slug, args) =>
      slug === INSPECT_TOOL && args.inspection_url === PAGE_URLS[1]
        ? Response.json({ successful: false }, { status: 503 })
        : null;
    const first = await receipt({}, true);
    const firstPageIssue = {
      ...assessment(PAGE_URLS[0]!),
      status: "issue",
      report: true,
    };
    expect(
      (
        await request({
          receiptHash: first.receiptHash,
          assessments: [
            firstPageIssue,
            { ...assessment(PAGE_URLS[1]!), status: "unavailable" },
          ],
        })
      ).status,
    ).toBe(200);
    expect(await receipt({}, true)).toMatchObject({
      receiptHash: first.receiptHash,
      assessmentSaved: true,
    });
    expect(reads.filter((read) => read.slug === INSPECT_TOOL)).toHaveLength(
      PAGE_URLS.length,
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1);
    providerHook = async (slug, args) => {
      if (slug !== INSPECT_TOOL) return null;
      return args.inspection_url === PAGE_URLS[0]
        ? Response.json({ successful: false }, { status: 503 })
        : Response.json({
            successful: true,
            data: {
              inspectionResult: { indexStatusResult: { verdict: "PASS" } },
            },
          });
    };
    const recovered = await receipt({}, false);
    expect(recovered.receiptHash).not.toBe(first.receiptHash);
    expect(recovered.pages.map((page) => page.verdict)).toEqual([
      "NEUTRAL",
      "PASS",
    ]);
    expect(recovered.assessmentSaved).toBeUndefined();
    expect(
      reads
        .filter((read) => read.slug === INSPECT_TOOL)
        .map((read) => read.input.arguments.inspection_url),
    ).toEqual([...PAGE_URLS, PAGE_URLS[1]]);
    const reported = [
      firstPageIssue,
      { ...assessment(PAGE_URLS[1]!), status: "indexed" },
    ];
    expect(
      (
        await request({
          receiptHash: recovered.receiptHash,
          assessments: reported,
        })
      ).status,
    ).toBe(200);
    const recoveredAssessment =
      await prisma.projectSeoObservation.findFirstOrThrow({
        where: {
          auditId,
          sourceKey: `task-index-triage:${taskId}:${recovered.receiptHash}`,
        },
      });
    expect(recoveredAssessment.payload).toMatchObject({
      checkedAt: recovered.checkedAt,
      assessments: [
        { pageUrl: PAGE_URLS[0], checkedAt: first.checkedAt },
        { pageUrl: PAGE_URLS[1] },
      ],
    });
    expect(await receipt({}, false)).toMatchObject({
      receiptHash: recovered.receiptHash,
      assessmentSaved: true,
    });
    vi.setSystemTime(Date.parse(first.checkedAt) + 24 * 60 * 60 * 1000 + 1);
    expect(
      (
        await request({
          receiptHash: recovered.receiptHash,
          assessments: reported,
        })
      ).status,
    ).toBe(409);
    const expired = await receipt({}, true);
    expect(expired.pages.map((page) => page.verdict)).toEqual([
      "VERDICT_UNSPECIFIED",
      "PASS",
    ]);
    expect(
      reads
        .filter((read) => read.slug === INSPECT_TOOL)
        .map((read) => read.input.arguments.inspection_url),
    ).toEqual([...PAGE_URLS, PAGE_URLS[1], PAGE_URLS[0]]);
  });

  it.each([
    { previous: "issue", next: "review", available: false, expected: "issue" },
    {
      previous: "issue",
      next: "review",
      available: undefined,
      expected: "issue",
    },
    {
      previous: "issue",
      next: "indexed",
      available: undefined,
      expected: "indexed",
    },
    { previous: "indexed", next: "issue", available: true, expected: "issue" },
    { previous: "issue", next: "review", available: true, expected: "review" },
  ])(
    "reconciles related-page retry evidence ($previous to $next, public evidence $available)",
    async ({ previous, next, available, expected }) => {
      const seed = PAGE_URLS[0]!;
      const related = "https://example.test/missing-guide";
      await approveDiscovery([seed]);
      expect(
        (await selectPages([related], { seedPageUrls: [seed] })).status,
      ).toBe(200);
      providerHook = async (slug, args) =>
        slug !== INSPECT_TOOL
          ? null
          : args.inspection_url === seed
            ? Response.json({ successful: false }, { status: 503 })
            : Response.json({
                successful: true,
                data: {
                  inspectionResult: { indexStatusResult: { verdict: "PASS" } },
                },
              });
      const first = await receipt({}, true);
      const missing = {
        pageUrl: related,
        status: "issue",
        report: true,
        reason:
          "The audit received HTTP 404. Google reports Submitted and indexed.",
        suggestedFix: "Restore the missing page if it should remain in search.",
        evidence: [
          "Google left this URL out",
          "The related page returned HTTP 404.",
        ],
      };
      const indexed = {
        ...assessment(related),
        status: "indexed",
        reason: "Google reports this page as indexed.",
        evidence: ["The related page returned HTTP 200."],
      };
      const prior = previous === "issue" ? missing : indexed;
      const current =
        next === "issue"
          ? missing
          : next === "indexed"
            ? indexed
            : {
                ...assessment(related),
                reason: available
                  ? "The page currently has a noindex directive."
                  : "The current page could not be verified.",
              };
      const saved = await request({
        receiptHash: first.receiptHash,
        assessments: [{ ...assessment(seed), status: "unavailable" }, prior],
      });
      expect(saved.status).toBe(200);

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.parse(first.checkedAt) + 60 * 60 * 1000 + 1);
      providerHook = undefined;
      const recovered = await receipt({}, false);
      expect(
        reads
          .filter((read) => read.slug === INSPECT_TOOL)
          .map((read) => read.input.arguments.inspection_url),
      ).toEqual([seed, related, seed]);
      const replacement = await request({
        receiptHash: recovered.receiptHash,
        assessments: [
          assessment(seed),
          {
            ...current,
            ...(available !== undefined && {
              publicEvidenceAvailable: available,
            }),
          },
        ],
      });
      expect(replacement.status).toBe(200);
      const stored = await prisma.projectSeoObservation.findFirstOrThrow({
        where: {
          auditId,
          sourceKey: `task-index-triage:${taskId}:${recovered.receiptHash}`,
        },
      });
      expect(
        (stored.payload as { assessments: unknown[] }).assessments,
      ).toEqual([
        assessment(seed),
        {
          ...(expected === next ? current : prior),
          checkedAt: first.checkedAt,
        },
      ]);
    },
  );

  it("keeps the latest verified review through a third attempt with no public evidence", async () => {
    const seed = PAGE_URLS[0]!;
    const url = "https://example.test/retired-guide";
    await approveDiscovery([seed]);
    expect((await selectPages([url], { seedPageUrls: [seed] })).status).toBe(
      200,
    );
    providerHook = async (slug, args) =>
      slug === INSPECT_TOOL && args.inspection_url === seed
        ? Response.json({ successful: false }, { status: 503 })
        : null;
    const original = {
      ...assessment(url),
      reason: "Verify the current robots.txt restriction.",
    };
    const updated = {
      ...assessment(url),
      reason: "Confirm whether the newly observed noindex is intended.",
    };
    const finish = async (
      receiptHash: string,
      note: ReturnType<typeof assessment>,
      available: boolean,
      seedRecovered = false,
    ) => {
      const response = await request({
        receiptHash,
        assessments: [
          {
            ...assessment(seed),
            status: seedRecovered ? "review" : "unavailable",
          },
          { ...note, publicEvidenceAvailable: available },
        ],
      });
      expect(response.status).toBe(200);
    };
    const first = await receipt({}, true);
    await finish(first.receiptHash, original, true);
    vi.useFakeTimers({ toFake: ["Date"] });
    const retryDelay = 60 * 60 * 1000 + 1;
    vi.setSystemTime(Date.parse(first.checkedAt) + retryDelay);
    const second = await receipt({}, true);
    await finish(second.receiptHash, updated, true);
    vi.setSystemTime(Date.parse(second.checkedAt) + retryDelay);
    providerHook = undefined;
    const last = await receipt({}, false);
    await finish(
      last.receiptHash,
      { ...assessment(url), reason: "Could not reach the page." },
      false,
      true,
    );

    const stored = await prisma.projectSeoObservation.findFirstOrThrow({
      where: {
        auditId,
        sourceKey: `task-index-triage:${taskId}:${last.receiptHash}`,
      },
    });
    expect((stored.payload as { assessments: unknown[] }).assessments).toEqual([
      assessment(seed),
      { ...updated, checkedAt: first.checkedAt },
    ]);
  });

  it("preserves Google's explicit unknown result without retrying a successful provider read", async () => {
    providerHook = async (slug) =>
      slug === INSPECT_TOOL
        ? Response.json({
            successful: true,
            data: {
              inspectionResult: {
                indexStatusResult: { verdict: "VERDICT_UNSPECIFIED" },
              },
            },
          })
        : null;
    const first = await receipt({}, false);
    expect(first.status).toBe("unavailable");
    expect(await receipt({}, false)).toEqual(first);
    expect(reads.filter((read) => read.slug === INSPECT_TOOL)).toHaveLength(
      PAGE_URLS.length,
    );
  });

  it("records which URL Google answered when an explicit unknown and an outage occur together", async () => {
    providerHook = async (slug, args) => {
      if (slug !== INSPECT_TOOL) return null;
      return args.inspection_url === PAGE_URLS[0]
        ? Response.json({
            successful: true,
            data: {
              inspectionResult: {
                indexStatusResult: { verdict: "VERDICT_UNSPECIFIED" },
              },
            },
          })
        : Response.json({ successful: false }, { status: 503 });
    };
    const result = await receipt({}, true);
    const saved = await prisma.projectSeoObservation.findFirstOrThrow({
      where: {
        auditId,
        sourceTaskId: taskId,
        kind: "index_inspection",
        artifactHash: result.receiptHash,
      },
    });
    expect(saved.payload).toMatchObject({
      answeredUnknownPageUrls: [PAGE_URLS[0]],
    });
    expect(result).not.toHaveProperty("answeredUnknownPageUrls");
  });

  it.each(["new", "legacy"])(
    "projects only Core-verified unknowns for a %s assessment",
    async (format) => {
      providerHook = async (slug, args) => {
        if (slug !== INSPECT_TOOL) return null;
        return args.inspection_url === PAGE_URLS[0]
          ? Response.json({
              successful: true,
              data: {
                inspectionResult: {
                  indexStatusResult: { verdict: "VERDICT_UNSPECIFIED" },
                },
              },
            })
          : Response.json({ successful: false }, { status: 503 });
      };
      const first = await receipt({}, true);
      const input = {
        receiptHash: first.receiptHash,
        assessments: PAGE_URLS.map((pageUrl) => ({
          ...assessment(pageUrl),
          status: "unavailable",
          evidence: [
            "Google URL Inspection: VERDICT_UNSPECIFIED; no coverage reason returned.",
          ],
        })),
      };
      expect(
        (
          await request({
            ...input,
            assessments: input.assessments.map((page) => ({
              ...page,
              googleReturnedUnknown: true,
            })),
          })
        ).status,
      ).toBe(422);
      expect((await request(input)).status).toBe(200);
      const saved = await prisma.projectSeoObservation.findFirstOrThrow({
        where: { auditId, sourceTaskId: taskId, kind: "index_triage" },
      });
      if (format === "legacy") {
        const legacy = seoTaskIndexingResultSchema.parse(saved.payload);
        legacy.assessments = legacy.assessments.map(
          ({ googleReturnedUnknown: _proof, ...page }) => page,
        );
        const artifactHash = sha256(JSON.stringify(legacy));
        await prisma.projectSeoObservation.update({
          where: { id: saved.id },
          data: { payload: legacy, artifactHash },
        });
        expect((await request(input)).status).toBe(200);
        expect(
          (
            await prisma.projectSeoObservation.findUniqueOrThrow({
              where: { id: saved.id },
            })
          ).artifactHash,
        ).toBe(artifactHash);
        expect((await receipt({}, true)).assessmentSaved).toBe(true);
      }
      const { owner, query } = await createPublicAudit();
      const view = async () =>
        (
          await getProjectSeoWorkspace(owner, query)
        ).indexTriage?.assessments.map((page) =>
          Object.hasOwn(page, "googleReturnedUnknown"),
        );
      expect(await view()).toEqual([true, false]);
      if (format === "legacy") {
        const originalReceipt =
          await prisma.projectSeoObservation.findFirstOrThrow({
            where: { auditId, sourceTaskId: taskId, kind: "index_inspection" },
          });
        await prisma.projectSeoObservation.update({
          where: { id: originalReceipt.id },
          data: { scopeVersion: originalReceipt.scopeVersion + 1 },
        });
        expect(await view()).toEqual([false, false]);
        await prisma.projectSeoObservation.update({
          where: { id: originalReceipt.id },
          data: { scopeVersion: originalReceipt.scopeVersion },
        });
      }
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.parse(first.checkedAt) + 60 * 60 * 1000 + 1);
      providerHook = undefined;
      const replacement = await receipt({}, false);
      expect(replacement.receiptHash).not.toBe(first.receiptHash);
      // A new receipt is not proof of an earlier assessment. New immutable results keep their original proof.
      expect(await view()).toEqual([format === "new", false]);
    },
  );

  it("preserves previously verified pages through a permission lookup outage and rereads them for another property", async () => {
    const first = await receipt({}, false);
    providerHook = async (slug) =>
      slug === LIST_TOOL
        ? Response.json({ successful: false }, { status: 503 })
        : null;
    expect((await request()).status).toBe(503);
    providerHook = undefined;
    expect((await receipt({}, false)).receiptHash).toBe(first.receiptHash);
    const changedProperty = "https://example.test/";
    providerHook = async (slug) =>
      slug === LIST_TOOL
        ? Response.json({
            successful: true,
            data: {
              siteEntry: [
                { siteUrl: changedProperty, permissionLevel: "siteOwner" },
              ],
            },
          })
        : null;
    const changed = await receipt({}, false);
    expect(changed.receiptHash).not.toBe(first.receiptHash);
    expect(
      reads
        .filter((read) => read.slug === INSPECT_TOOL)
        .map((read) => read.input.arguments.site_url),
    ).toEqual([PROPERTY, PROPERTY, changedProperty, changedProperty]);
  });

  it("requires a choice and keeps the selected property after a different page syncs", async () => {
    providerHook = async (slug) =>
      slug === LIST_TOOL
        ? Response.json({
            successful: true,
            data: {
              siteEntry: [PROPERTY, "https://example.test/"].map((siteUrl) => ({
                siteUrl,
                permissionLevel: "siteOwner",
              })),
            },
          })
        : null;
    expect((await receipt()).status).toBe("needs_property");
    expect(reads.filter((read) => read.slug === INSPECT_TOOL)).toHaveLength(0);
    const { pageIds } = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
      select: { pageIds: true },
    });
    const other = await prisma.projectSeoPage.create({
      data: { auditId, url: "https://example.test/blog/" },
    });
    await prisma.projectSeoObservation.createMany({
      data: [
        { propertyId: PROPERTY, pageIds, observedAt: new Date("2026-09-01") },
        {
          propertyId: other.url,
          pageIds: [other.id],
          observedAt: new Date("2026-09-02"),
        },
      ].map(({ propertyId, pageIds, observedAt }) => ({
        auditId,
        sourceKey: randomUUID(),
        kind: "metrics",
        source: "search_console",
        ownerId,
        pageIds,
        artifactHash: "fixture-selection",
        payload: { propertyId },
        observedAt,
      })),
    });
    expect((await receipt()).status).toBe("available");
    expect(reads.filter((read) => read.slug === INSPECT_TOOL)).toHaveLength(
      PAGE_URLS.length,
    );
  });

  it("serializes duplicate collection and never repeats the URL reads in parallel", async () => {
    let release!: () => void, started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen = new Promise<void>((resolve) => {
      started = resolve;
    });
    providerHook = async (slug) => {
      if (slug === INSPECT_TOOL) {
        started();
        await held;
      }
      return null;
    };
    const first = request();
    await seen;
    const duplicate = await request();
    expect(duplicate.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(reads.filter((read) => read.slug === INSPECT_TOOL)).toHaveLength(
      PAGE_URLS.length,
    );
  });

  it("does not reuse cached Google data after property permission is removed", async () => {
    await receipt();
    providerHook = async (slug) =>
      slug === LIST_TOOL
        ? Response.json({
            successful: true,
            data: {
              siteEntry: [
                { siteUrl: PROPERTY, permissionLevel: "siteUnverifiedUser" },
              ],
            },
          })
        : null;
    const denied = await receipt({}, false);
    expect(denied.status).toBe("needs_property");
    expect(
      denied.pages.every((page) => page.verdict === "VERDICT_UNSPECIFIED"),
    ).toBe(true);
    expect(reads.filter((read) => read.slug === INSPECT_TOOL)).toHaveLength(
      PAGE_URLS.length,
    );
  });

  it("expires a receipt before accepting results and recollects the inspection", async () => {
    const first = await receipt();
    const dayMs = 24 * 60 * 60 * 1000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + dayMs + 1);
    expect(
      (
        await request({
          receiptHash: first.receiptHash,
          assessments: PAGE_URLS.map(assessment),
        })
      ).status,
    ).toBe(409);
    expect((await receipt()).receiptHash).not.toBe(first.receiptHash);
    expect(reads.filter((read) => read.slug === INSPECT_TOOL)).toHaveLength(
      PAGE_URLS.length * 2,
    );
  });

  it("does not turn an ordinary assigned Task into private Google authority", async () => {
    await prisma.projectSeoAnalysis.deleteMany({ where: { taskId } });
    expect((await request()).status).toBe(404);
    expect(reads).toEqual([]);
  });

  it("uses the unique covering property after an older selection is no longer accessible", async () => {
    const { pageIds } = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
      select: { pageIds: true },
    });
    await prisma.projectSeoObservation.create({
      data: {
        auditId,
        sourceKey: randomUUID(),
        kind: "metrics",
        source: "search_console",
        ownerId,
        pageIds,
        artifactHash: "fixture-old-selection",
        payload: { propertyId: "https://example.test/old/" },
        observedAt: new Date(),
      },
    });
    expect((await receipt()).status).toBe("available");
    expect(
      reads
        .filter((read) => read.slug === INSPECT_TOOL)
        .every((read) => read.input.arguments.site_url === PROPERTY),
    ).toBe(true);
  });

  it("shows triage only to its requesting owner, not another seated member or a shared bot context", async () => {
    const first = await receipt();
    expect(
      (
        await request({
          receiptHash: first.receiptHash,
          assessments: PAGE_URLS.map((pageUrl) => ({
            ...assessment(pageUrl),
            status: "issue",
            report: true,
            suggestedFix:
              "Confirm search intent, then review the canonical and internal links.",
          })),
        })
      ).status,
    ).toBe(200);
    const { owner, query, publicAudit } = await createPublicAudit();
    // More than the former ten-row cap must not evict this audit's Console assessment.
    const held = await prisma.projectSeoObservation.findFirstOrThrow({
      where: { auditId, kind: "index_triage", sourceTaskId: taskId },
    });
    await prisma.projectSeoObservation.createMany({
      data: Array.from({ length: 11 }, () => {
        const otherTaskId = randomUUID();
        return {
          auditId,
          kind: "index_triage",
          source: "seo_worker",
          sourceKey: randomUUID(),
          sourceTaskId: otherTaskId,
          ownerId,
          visibility: "PRIVATE",
          pageIds: query.pageIds,
          scopeVersion: 0,
          artifactHash: "unrelated-assessment",
          observedAt: new Date(Date.now() + 1000),
          payload: { ...(held.payload as object), taskId: otherTaskId },
        };
      }),
    });
    const ownView = await getProjectSeoWorkspace(owner, query);
    expect(
      ownView.indexTriage?.assessments.map((page) => page.pageUrl),
    ).toEqual(PAGE_URLS);
    expect(ownView.findings.map((finding) => finding.observationId)).toEqual([
      publicAudit.id,
      publicAudit.id,
    ]);
    expect(ownView.findings.every((finding) => finding.suggestedFix)).toBe(
      true,
    );
    expect(
      ownView.observations.find((row) => row.id === publicAudit.id)?.issues,
    ).toBe(2);
    const sharedChatView = await getProjectSeoWorkspace(owner, query, {
      includePrivateIndexing: false,
    });
    expect(sharedChatView.findings).toEqual([]);
    expect(sharedChatView.indexTriage).toBeNull();
    expect(
      sharedChatView.observations.find((row) => row.id === publicAudit.id)
        ?.issues,
    ).toBe(0);
    const memberView = await getProjectSeoWorkspace(
      { ...owner, userId: otherOwnerId },
      query,
    );
    expect(memberView.indexTriage).toBeNull();
    expect(memberView.findings).toEqual([]);
    const sharedView = await getProjectSeoWorkspace(
      { ...owner, sokoBotId: randomUUID(), privateMetricsAllowed: false },
      query,
    );
    expect(sharedView.indexTriage).toBeNull();
    expect(sharedView.findings).toEqual([]);
  });
});
