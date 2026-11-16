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
import type { SeoTaskIndexingReceipt } from "@/schemas/seo-task-indexing.schema";
import { getProjectSeoWorkspace } from "@/services/project-seo.service";
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
  async function approveDiscovery(pageUrls: string[] = PAGE_URLS) {
    const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    const packet = {
      version: 1,
      requestId: analysis.id,
      pageUrls,
      discoverRelated: true,
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
        request: packet,
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
      `http://localhost/${taskId}/seo-pages/context-v1`,
      jsonRequest("POST", {
        expectedContext,
        seedPageUrls: PAGE_URLS,
        relatedPageUrls,
        ...extra,
      }),
    );
  }
  async function receipt() {
    const response = await request();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return (await response.json()).data as SeoTaskIndexingReceipt;
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

  it("seals discovered pages once and accepts only their frozen report scope", async () => {
    const original = await approveDiscovery();
    const first = await selectPages();
    expect(first.status, await first.clone().text()).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const selected = [...PAGE_URLS, "https://example.test/related"];
    expect((await first.json()).data.pageUrls).toEqual(selected);
    const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    expect(analysis.pageIds).toHaveLength(3);
    expect(analysis.request).toMatchObject({
      pageUrls: selected,
      relatedPageSelection: { seedPageUrls: PAGE_URLS, pageUrls: selected },
    });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: taskId } }))
        .description,
    ).toBe(`seo_audit: ${JSON.stringify(original)}`);
    const related = await prisma.projectSeoPage.findFirstOrThrow({
      where: { auditId, url: selected[2] },
    });
    expect(related.relationship).toBe("related");
    expect(related.relatedToPageId).toBe(analysis.pageIds[0]);
    const retried = await selectPages(["https://example.test/different"]);
    expect(retried.status).toBe(200);
    expect((await retried.json()).data.pageUrls).toEqual(selected);
    expect(
      await prisma.projectSeoPage.count({
        where: { auditId, url: "https://example.test/different" },
      }),
    ).toBe(0);
    const raw = {
      ...siteStrategyReport(),
      pages: selected.map((url) => ({
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
        {
          ...payload,
          pageUrls: [...selected, "https://example.test/not-selected"],
        },
        analysis,
      ),
    ).toThrow("frozen page scope");
    expect(reads).toEqual([]);
  });

  it("keeps the first committed selection when discovery races", async () => {
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
    expect(bodies[0].data.pageUrls).toEqual(bodies[1].data.pageUrls);
    expect(bodies[0].data.pageUrls).toHaveLength(3);
    expect(
      await prisma.projectSeoPage.count({
        where: {
          auditId,
          url: {
            in: [
              "https://example.test/race-one",
              "https://example.test/race-two",
            ],
          },
        },
      }),
    ).toBe(1);
    expect(reads).toEqual([]);
  });

  it("keeps discoveries from a related page visible under the Audit primary page", async () => {
    const primary = await prisma.projectSeoPage.findFirstOrThrow({
      where: { auditId, url: PAGE_URLS[0] },
    });
    const child = await prisma.projectSeoPage.update({
      where: { auditId_url: { auditId, url: PAGE_URLS[1]! } },
      data: { relationship: "related", relatedToPageId: primary.id },
    });
    await approveDiscovery([child.url]);
    const response = await selectPages(["https://example.test/discovered"], {
      seedPageUrls: [child.url],
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const found = await prisma.projectSeoPage.findFirstOrThrow({
      where: { auditId, url: "https://example.test/discovered" },
    });
    expect(found.relatedToPageId).toBe(primary.id);
    const workspace = await getProjectSeoWorkspace(
      {
        userId: ownerId,
        organizationId,
        workspaceId,
        owner: { kind: "audit", id: auditId },
      },
      { pageId: primary.id },
    );
    expect(workspace.scope.pageIds).toEqual([primary.id, child.id, found.id]);
  });

  it("rejects foreign, private and oversized discovery without changing approved pages", async () => {
    await approveDiscovery();
    for (const candidates of [
      ["https://other.test/a"],
      ["https://example.test/account"],
      Array.from({ length: 8 }, (_, index) => {
        const prefix = `https://example.test/large-${index}/`;
        return prefix + "x".repeat(4096 - prefix.length);
      }),
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
    expect(reads).toEqual([]);
  });

  it("requires current Task authority and unchanged original input for discovery", async () => {
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

  it.each([
    { nested: false, extra: false },
    { nested: true, extra: false },
    { nested: false, extra: true },
    { nested: true, extra: true },
  ])(
    "preserves valid related seeds without a direct primary parent: %j",
    async ({ nested, extra }) => {
      const primary = await prisma.projectSeoPage.findFirstOrThrow({
        where: { auditId, url: PAGE_URLS[0] },
      });
      const middle = nested
        ? await prisma.projectSeoPage.create({
            data: {
              auditId,
              url: "https://example.test/middle",
              relationship: "related",
              relatedToPageId: primary.id,
            },
          })
        : null;
      const child = await prisma.projectSeoPage.update({
        where: { auditId_url: { auditId, url: PAGE_URLS[1]! } },
        data: { relationship: "related", relatedToPageId: middle?.id ?? null },
      });
      await approveDiscovery([child.url]);
      const response = await selectPages(
        extra ? ["https://example.test/found"] : [],
        { seedPageUrls: [child.url] },
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(
        await prisma.projectSeoPage.findUnique({ where: { id: child.id } }),
      ).toMatchObject({
        relationship: "related",
        relatedToPageId: middle?.id ?? null,
      });
      if (extra)
        expect(
          await prisma.projectSeoPage.findFirst({
            where: { auditId, url: "https://example.test/found" },
          }),
        ).toMatchObject({ relatedToPageId: primary.id });
    },
  );

  it("keeps the newest audited related pages visible when older children fill the primary scope", async () => {
    const primary = await prisma.projectSeoPage.findFirstOrThrow({
      where: { auditId, url: PAGE_URLS[0] },
    });
    await prisma.projectSeoPage.createMany({
      data: Array.from({ length: 9 }, (_, index) => ({
        auditId,
        url: `https://example.test/old-${index}`,
        relationship: "related",
        relatedToPageId: primary.id,
        createdAt: new Date("2020-01-01T00:00:00Z"),
      })),
    });
    const child = await prisma.projectSeoPage.update({
      where: { auditId_url: { auditId, url: PAGE_URLS[1]! } },
      data: { relationship: "related", relatedToPageId: primary.id },
    });
    await approveDiscovery([child.url]);
    const response = await selectPages(["https://example.test/newly-audited"], {
      seedPageUrls: [child.url],
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const found = await prisma.projectSeoPage.findFirstOrThrow({
      where: { auditId, url: "https://example.test/newly-audited" },
    });
    const workspace = await getProjectSeoWorkspace(
      {
        userId: ownerId,
        organizationId,
        workspaceId,
        owner: { kind: "audit", id: auditId },
      },
      { pageId: primary.id },
    );
    expect(workspace.scope.pageIds.slice(0, 3)).toEqual([
      primary.id,
      child.id,
      found.id,
    ]);
    expect(workspace.scope.pageIds).toHaveLength(10);
  });

  it("includes saved related children only when reading the Audit's primary page", async () => {
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
    await prisma.projectSeoPage.create({
      data: {
        auditId,
        url: "https://example.test/saved-%63hild",
        relationship: "related",
        relatedToPageId: primary.id,
      },
    });
    await prisma.projectSeoPage.create({
      data: {
        auditId,
        url: "https://foreign.test/child",
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
    ).toEqual([primary.id, child.id]);
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
    const first = await receipt();
    expect(first.status).toBe("available");
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

  it("requires a property choice when multiple properties cover the pages", async () => {
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
    await prisma.projectSeoObservation.create({
      data: {
        auditId,
        sourceKey: randomUUID(),
        kind: "metrics",
        source: "search_console",
        ownerId,
        pageIds: [],
        artifactHash: "fixture-selection",
        payload: { propertyId: PROPERTY },
        observedAt: new Date(),
      },
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
    const denied = await receipt();
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
    await prisma.projectSeoObservation.create({
      data: {
        auditId,
        sourceKey: randomUUID(),
        kind: "metrics",
        source: "search_console",
        ownerId,
        pageIds: [],
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
