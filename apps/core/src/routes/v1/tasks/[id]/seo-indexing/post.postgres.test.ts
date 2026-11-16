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

import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";
import type { SeoTaskIndexingReceipt } from "@/schemas/seo-task-indexing.schema";
import { getProjectSeoWorkspace } from "@/services/project-seo.service";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";
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
          assessments: PAGE_URLS.map(assessment),
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
    const ownView = await getProjectSeoWorkspace(owner, query);
    expect(
      ownView.indexTriage?.assessments.map((page) => page.pageUrl),
    ).toEqual(PAGE_URLS);
    const memberView = await getProjectSeoWorkspace(
      { ...owner, userId: otherOwnerId },
      query,
    );
    expect(memberView.indexTriage).toBeNull();
    const sharedView = await getProjectSeoWorkspace(
      { ...owner, sokoBotId: randomUUID(), privateMetricsAllowed: false },
      query,
    );
    expect(sharedView.indexTriage).toBeNull();
  });
});
