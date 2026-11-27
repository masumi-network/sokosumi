import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { seoCrawlNextPrice } from "@sokosumi/utils";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getEnv } from "@/config/env";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import mountTaskEvents from "@/routes/v1/tasks/[id]/events/post";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { requestSeoCrawlNextSchema } from "@/schemas/seo-audit-price.schema";
import { seoSiteCrawlSchema } from "@/schemas/seo-site-crawl.schema";
import { testSchemaNames } from "@/test/split-layout";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";
import {
  addProjectSeoPage,
  getProjectSeoWorkspace,
} from "./project-seo.service";
import { importProjectSeoAudit } from "./project-seo-import.service";
import { SEO_WORKSPACE_EVIDENCE_LIMIT } from "./project-seo-store";
import { requestSeoCrawlNext } from "./seo-crawl-next.service";

vi.mock("@/middleware/auth", async (original) => ({
  ...(await original<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@vercel/functions", async (original) => ({
  ...(await original<typeof import("@vercel/functions")>()),
  waitUntil: vi.fn(),
}));
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const mainnet =
  enabled && url
    ? createPrismaClient(url, {
        schema: testSchemaNames().DATABASE_SCHEMA_MAINNET,
      })
    : null;

const CREDIT = 10n ** 10n;
const SITE = "https://example.test/";
const AUDIT_CRAWL = "a".repeat(64),
  NEXT_CRAWL = "b".repeat(64);
const userId = randomUUID(),
  workspaceId = randomUUID(),
  auditId = randomUUID(),
  vendorId = randomUUID(),
  coworkerId = randomUUID();
const actor: SeoActor = {
  owner: { kind: "audit", id: auditId },
  userId,
  workspaceId,
  organizationId: null,
};
const env = getEnv();
const previous = {
  executor: env.SEO_ANALYSIS_EXECUTOR,
  dispatch: env.SEO_ANALYSIS_DISPATCH_ENABLED,
  crawlNext: env.SEO_CRAWL_NEXT_ENABLED,
};
let pageId: string;

const request = (continues = AUDIT_CRAWL, idempotencyKey = randomUUID()) =>
  requestSeoCrawlNextSchema.parse({
    continues,
    price: seoCrawlNextPrice(),
    idempotencyKey,
  });

/** A stored crawl, as the import writes it. */
async function storeCrawl(
  kind: "audit_full" | "crawl_next",
  crawl: { snapshotId: string; continues?: string; stop: string },
  observedAt: Date,
  pageIds = [pageId],
) {
  const siteCrawl = seoSiteCrawlSchema.parse({
    state: "crawled",
    startUrl: SITE,
    fetched: 500,
    read: 480,
    links: null,
    javascript: null,
    orphans: null,
    pageChecks: null,
    gaps: [],
    ...crawl,
  });
  const payload = publicSeoPayloadSchema.parse({
    version: 1,
    kind,
    requestId: null,
    pageUrls: [SITE],
    observedAt: observedAt.toISOString(),
    countryCode: "US",
    languageCode: "en",
    rulebookVersion: "crawl",
    siteCrawl,
    checks: [],
    keywords: [],
    competitors: [],
    findings: [],
    actions: [],
    coverage: { checked: 0, skipped: 0, failed: 0 },
    notes: [],
  });
  await prisma.projectSeoObservation.create({
    data: {
      auditId,
      kind,
      source: "seo_coworker",
      sourceKey: randomUUID(),
      pageIds,
      artifactHash: randomUUID(),
      payload: JSON.parse(JSON.stringify(payload)),
      observedAt,
    },
  });
}

async function setBalance(credits: bigint) {
  if (!mainnet) throw new Error("Missing integration database");
  await mainnet.creditBucket.deleteMany({ where: { userId } });
  if (credits === 0n) return;
  const topUp = await mainnet.transaction.create({
    data: { amount: credits * CREDIT, userId },
    select: { id: true },
  });
  await mainnet.creditBucket.create({
    data: { amount: credits * CREDIT, userId, sourceTransactionId: topUp.id },
  });
}

const continueFrom = async () =>
  (await getProjectSeoWorkspace(actor)).availableActions.continueCrawlFrom;

describe.skipIf(!enabled)("crawl continuation request", () => {
  beforeAll(async () => {
    env.SEO_ANALYSIS_DISPATCH_ENABLED = true;
    env.SEO_CRAWL_NEXT_ENABLED = true;
    env.SEO_ANALYSIS_EXECUTOR = {
      coworkerId,
      workspaceId,
      ownerId: userId,
      organizationId: null,
      canUsePaidSearchData: true,
      canSchedule: true,
    };
    await prisma.user.create({
      data: {
        id: userId,
        name: "SEO crawl owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.seoAudit.create({
      data: { id: auditId, workspaceId, createdById: userId, name: "Crawl" },
    });
    await prisma.vendor.create({
      data: { id: vendorId, slug: vendorId, name: "SEO crawl vendor" },
    });
    await prisma.coworker.create({
      data: {
        id: coworkerId,
        slug: coworkerId,
        name: "SEO checks",
        vendorId,
        isWhitelisted: true,
        capabilities: ["tasks"],
      },
    });
    pageId = (
      await addProjectSeoPage(actor, { url: SITE, relationship: "primary" })
    ).id;
  });
  beforeEach(async () => {
    await prisma.projectSeoAnalysis.deleteMany({ where: { auditId } });
    await prisma.projectSeoObservation.deleteMany({ where: { auditId } });
    await prisma.task.deleteMany({ where: { workspaceId } });
    await setBalance(0n);
    env.SEO_CRAWL_NEXT_ENABLED = true;
  });
  afterAll(async () => {
    env.SEO_ANALYSIS_EXECUTOR = previous.executor;
    env.SEO_ANALYSIS_DISPATCH_ENABLED = previous.dispatch;
    env.SEO_CRAWL_NEXT_ENABLED = previous.crawlNext;
    await prisma.task.deleteMany({ where: { workspaceId } });
    await mainnet?.creditBucket.deleteMany({ where: { userId } });
    await mainnet?.transaction.deleteMany({ where: { userId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.coworker.deleteMany({ where: { vendorId } });
    await prisma.vendor.delete({ where: { id: vendorId } });
    await mainnet?.$disconnect();
  });

  it("offers nothing and refuses while the flag is off", async () => {
    await storeCrawl(
      "audit_full",
      { snapshotId: AUDIT_CRAWL, stop: "page cap" },
      new Date("2026-11-01"),
    );
    env.SEO_CRAWL_NEXT_ENABLED = false;
    expect(await continueFrom()).toBeNull();
    await expect(requestSeoCrawlNext(actor, request())).rejects.toMatchObject({
      status: 404,
    });
  });

  it("goes on from the newest crawl of the chain and starts a Task the SEO check service can run", async () => {
    await storeCrawl(
      "audit_full",
      { snapshotId: AUDIT_CRAWL, stop: "page cap" },
      new Date("2026-11-01"),
    );
    await storeCrawl(
      "crawl_next",
      { snapshotId: NEXT_CRAWL, continues: AUDIT_CRAWL, stop: "time" },
      new Date("2026-11-02"),
    );
    expect(await continueFrom()).toBe(NEXT_CRAWL);
    await setBalance(100n);
    await expect(requestSeoCrawlNext(actor, request())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("A newer crawl goes on from this one"),
    });

    await setBalance(99n);
    await expect(
      requestSeoCrawlNext(actor, request(NEXT_CRAWL)),
    ).rejects.toMatchObject({ status: 422 });
    expect(await prisma.task.count({ where: { workspaceId } })).toBe(0);

    await setBalance(100n);
    const body = request(NEXT_CRAWL);
    const analysis = await requestSeoCrawlNext(actor, body);
    expect(analysis).toMatchObject({ kind: "crawl_next", pageIds: [pageId] });
    // A retry with the same key replays the first request.
    expect((await requestSeoCrawlNext(actor, body)).id).toBe(analysis.id);
    await expect(
      requestSeoCrawlNext(actor, request(NEXT_CRAWL)),
    ).rejects.toMatchObject({ status: 409 });

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: analysis.taskId! },
    });
    expect(task.description).toContain(
      `seo_crawl_next: ${JSON.stringify({ version: 1, url: SITE, continues: NEXT_CRAWL, price: seoCrawlNextPrice() })}`,
    );
    const app = createTaskScheduleTestApp(
      mountTaskEvents,
      { actor: "coworker", coworkerId, vendorId },
      null,
    );
    const started = await app.request(
      `http://localhost/${task.id}/events`,
      jsonRequest("POST", { status: "RUNNING" }),
    );
    expect(started.status).toBe(201);
  });

  it("waits for a completed continuation's Report before it buys the same pages again", async () => {
    await storeCrawl(
      "audit_full",
      { snapshotId: AUDIT_CRAWL, stop: "page cap" },
      new Date("2026-11-01"),
    );
    await setBalance(100n);
    const first = await requestSeoCrawlNext(actor, request());
    await prisma.task.update({
      where: { id: first.taskId! },
      data: { status: "COMPLETED" },
    });
    // The chain still ends at the audit's crawl, as the Report has not arrived: no offer, and no sale.
    expect(await continueFrom()).toBeNull();
    await expect(requestSeoCrawlNext(actor, request())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("has not arrived yet"),
    });
    // A rejected Report fails the analysis, yet a corrected Report can still arrive: the wait holds.
    await prisma.projectSeoAnalysis.update({
      where: { id: first.id },
      data: { status: "failed", failureReason: "rejected" },
    });
    expect(await continueFrom()).toBeNull();
    await expect(requestSeoCrawlNext(actor, request())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("has not arrived yet"),
    });
    // Web waits three hours for a check that does not end, and Core waits as long.
    await prisma.task.update({
      where: { id: first.taskId! },
      data: { updatedAt: new Date(Date.now() - 16 * 60_000) },
    });
    await expect(requestSeoCrawlNext(actor, request())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("has not arrived yet"),
    });
    // A Report that never arrives stops blocking: the offer is back, and the balance check is next.
    await prisma.projectSeoAnalysis.update({
      where: { id: first.id },
      data: { createdAt: new Date(Date.now() - 4 * 60 * 60_000) },
    });
    expect(await continueFrom()).toBe(AUDIT_CRAWL);
    await setBalance(99n);
    await expect(requestSeoCrawlNext(actor, request())).rejects.toMatchObject({
      status: 422,
    });
    // A Task that ended late still gets its time for the Report.
    await prisma.task.update({
      where: { id: first.taskId! },
      data: { updatedAt: new Date() },
    });
    expect(await continueFrom()).toBeNull();
    await expect(requestSeoCrawlNext(actor, request())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("has not arrived yet"),
    });
  });

  it("offers the continuation only in a view that shows the crawl's start page", async () => {
    await storeCrawl(
      "audit_full",
      { snapshotId: AUDIT_CRAWL, stop: "page cap" },
      new Date("2026-11-01"),
    );
    const related = await addProjectSeoPage(actor, {
      url: `${SITE}pricing`,
      relationship: "related",
    });
    try {
      expect(await continueFrom()).toBe(AUDIT_CRAWL);
      const filtered = await getProjectSeoWorkspace(actor, {
        pageId: related.id,
      });
      expect(filtered.availableActions.continueCrawlFrom).toBeNull();
    } finally {
      await prisma.projectSeoPage.delete({ where: { id: related.id } });
    }
  });

  it("offers and sells no continuation of a full audit past the history the workspace loads", async () => {
    await storeCrawl(
      "audit_full",
      { snapshotId: AUDIT_CRAWL, stop: "page cap" },
      new Date("2026-11-01"),
    );
    await setBalance(100n);
    // Newer evidence of the same page: crawls of another chain.
    const newer = (from: number, to: number) =>
      Promise.all(
        Array.from({ length: to - from }, (_, i) =>
          storeCrawl(
            "crawl_next",
            {
              snapshotId: (from + i).toString(16).padStart(64, "0"),
              continues: "f".repeat(64),
              stop: "page cap",
            },
            new Date("2026-11-02"),
          ),
        ),
      );
    // The continuation's own row must still leave the full audit in the history the workspace loads.
    await newer(0, SEO_WORKSPACE_EVIDENCE_LIMIT - 2);
    expect(await continueFrom()).toBe(AUDIT_CRAWL);
    await newer(
      SEO_WORKSPACE_EVIDENCE_LIMIT - 2,
      SEO_WORKSPACE_EVIDENCE_LIMIT - 1,
    );
    expect(await continueFrom()).toBeNull();
    await expect(requestSeoCrawlNext(actor, request())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("older than the history"),
    });
    expect(await prisma.task.count({ where: { workspaceId } })).toBe(0);
  });

  it("offers no continuation in a view of the start page that other pages' evidence would refuse", async () => {
    await storeCrawl(
      "audit_full",
      { snapshotId: AUDIT_CRAWL, stop: "page cap" },
      new Date("2026-11-01"),
    );
    const related = await addProjectSeoPage(actor, {
      url: `${SITE}pricing`,
      relationship: "related",
    });
    try {
      // Newer evidence of another page only: the view of the start page loads none of it, the sale reads all of it.
      await Promise.all(
        Array.from({ length: SEO_WORKSPACE_EVIDENCE_LIMIT - 1 }, (_, i) =>
          storeCrawl(
            "crawl_next",
            {
              snapshotId: i.toString(16).padStart(64, "0"),
              continues: "f".repeat(64),
              stop: "page cap",
            },
            new Date("2026-11-02"),
            [related.id],
          ),
        ),
      );
      const view = await getProjectSeoWorkspace(actor, { pageId });
      expect(view.availableActions.continueCrawlFrom).toBeNull();
    } finally {
      await prisma.projectSeoObservation.deleteMany({ where: { auditId } });
      await prisma.projectSeoPage.delete({ where: { id: related.id } });
    }
  });

  it("keeps one crawl per paid continuation when its Task holds two Report files", async () => {
    await storeCrawl(
      "audit_full",
      { snapshotId: AUDIT_CRAWL, stop: "page cap" },
      new Date("2026-11-01"),
    );
    await setBalance(100n);
    const analysis = await requestSeoCrawlNext(actor, request());
    const taskId = analysis.taskId!;
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "COMPLETED" },
    });
    // The SEO bot's crawl_next Report, with no problem page to audit.
    const report = (snapshotId: string) =>
      JSON.stringify({
        kind: "crawl_next",
        request: { url: SITE, continues: AUDIT_CRAWL },
        crawl: {
          snapshotId,
          request: { url: SITE },
          crawl: { fetched: 500, read: 480, stop: "page cap" },
        },
        head: { skipped: [] },
        pages: [],
      });
    // The two names the SEO bot may give a JSON Report.
    const upload = async (name: string, body: string) => {
      const file = await prisma.taskFile.create({
        data: {
          taskId,
          name: `seo-report-${taskId}${name}`,
          fileUrl: `https://seo-test.public.blob.vercel-storage.com/tasks/${taskId}/${randomUUID()}.json`,
          mimeType: "application/json",
          size: BigInt(Buffer.byteLength(body)),
          uploadedByCoworkerId: coworkerId,
        },
      });
      return importProjectSeoAudit(
        actor,
        { taskId, fileId: file.id },
        { fetchImpl: async () => new Response(body) },
      );
    };
    const first = await upload(".json", report(NEXT_CRAWL));
    const second = await upload(".data.json", report("c".repeat(64)));
    expect(second.id).toBe(first.id);
    expect(
      await prisma.projectSeoObservation.count({
        where: { auditId, kind: "crawl_next", sourceTaskId: taskId },
      }),
    ).toBe(1);
  });

  it("refuses a continuation through the audit of a CMO Project", async () => {
    await storeCrawl(
      "audit_full",
      { snapshotId: AUDIT_CRAWL, stop: "page cap" },
      new Date("2026-11-01"),
    );
    await setBalance(100n);
    const project = await prisma.project.create({
      data: { workspaceId, name: "example.test" },
      select: { id: true },
    });
    const cuso = await prisma.sokoBot.create({
      data: {
        workspaceId,
        projectId: project.id,
        userId: null,
        createdByUserId: userId,
        versionId: CMO_SOKO_BOT_VERSION_IDS[0] ?? null,
        name: "Cuso",
      },
      select: { id: true },
    });
    await prisma.seoAudit.update({
      where: { id: auditId },
      data: { projectId: project.id },
    });
    try {
      await expect(requestSeoCrawlNext(actor, request())).rejects.toMatchObject(
        { status: 409, message: expect.stringContaining("managed by CMO") },
      );
      expect(await prisma.task.count({ where: { workspaceId } })).toBe(0);
    } finally {
      await prisma.seoAudit.update({
        where: { id: auditId },
        data: { projectId: null },
      });
      await prisma.sokoBot.delete({ where: { id: cuso.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("refuses a crawl that stopped for good", async () => {
    await storeCrawl(
      "audit_full",
      { snapshotId: AUDIT_CRAWL, stop: "page cap" },
      new Date("2026-11-01"),
    );
    await storeCrawl(
      "crawl_next",
      { snapshotId: NEXT_CRAWL, continues: AUDIT_CRAWL, stop: "complete" },
      new Date("2026-11-02"),
    );
    await setBalance(100n);
    expect(await continueFrom()).toBeNull();
    await expect(
      requestSeoCrawlNext(actor, request(NEXT_CRAWL)),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("This crawl cannot go on"),
    });
  });
});
