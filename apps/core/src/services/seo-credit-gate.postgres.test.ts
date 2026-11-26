import { createHash, randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import {
  CORE_API_ERROR_KINDS,
  seoFullAuditPrice,
  seoTaskRequestPacket,
} from "@sokosumi/utils";
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
import prisma from "@/lib/db/prisma";
import { requireSeoTaskStartBalance } from "@/lib/seo/analysis-price";
import { GSC_INSPECT_TOOL } from "@/lib/seo/native-gsc-inspection";
import { GSC_PROPERTIES_TOOL } from "@/lib/seo/native-statistics";
import { originalSeoAuditPacket } from "@/lib/seo/related-page-selection";
import mountAdminSeoAlerts from "@/routes/v1/admin/seo-alerts/get";
import mountTaskEvents from "@/routes/v1/tasks/[id]/events/post";
import {
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import { AUDIT_PERFORMANCE_KIND } from "@/schemas/seo-audit-performance.schema";
import { testSchemaNames } from "@/test/split-layout";
import { drainWaitUntil } from "@/test/wait-until";
import { testNetworkScope } from "@/test-fixtures/network-scope";
import { searchConsoleToolDescriptors } from "@/test-fixtures/seo-search-console";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";
import * as composio from "./composio-integration-tools.service";
import {
  addProjectSeoPage,
  getProjectSeoWorkspace,
} from "./project-seo.service";
import {
  createProjectSeoMonitor,
  releaseSeoMonitorRun,
} from "./project-seo-monitor.service";
import {
  requestProjectSeoAnalysis,
  seoTaskPacket,
} from "./project-seo-operations.service";
import { createSeoAudit } from "./seo-audit.service";
import { getSeoBrief, saveSeoBrief } from "./seo-audit-brief.service";
import {
  createTaskSchedule,
  runTaskScheduleNow,
  updateTaskSchedule,
} from "./task-schedule.service";

vi.mock("@/middleware/auth", async (original) => ({
  ...(await original<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@/clients/composio.client", async (original) => ({
  ...(await original<typeof import("@/clients/composio.client")>()),
  getComposio: () => ({}),
}));
vi.mock("@vercel/functions", async (original) => ({
  ...(await original<typeof import("@vercel/functions")>()),
  waitUntil: vi.fn(),
}));
// The flow publishes over Ably; the test env has no real key.
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

afterAll(async () => {
  await mainnet?.$disconnect();
});

function networkDatabase() {
  if (!mainnet) throw new Error("Missing integration database");
  return mainnet;
}

const CREDIT = 10n ** 10n;
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
const previousExecutor = env.SEO_ANALYSIS_EXECUTOR,
  previousDispatch = env.SEO_ANALYSIS_DISPATCH_ENABLED;
const vars = {
  isAuthenticated: true,
  networkScope: testNetworkScope(),
  authContext: {
    actor: "user" as const,
    userId,
    organizationId: null,
    role: "user",
  },
  workspaceContext: { workspaceId, userId, organizationId: null },
};
let pageId: string, secondPageId: string;
// 20 SERP calls at most 5 cents each, plus 50%: up to 150 credits.
const rankings = () =>
  requestSeoAnalysisSchema.parse({
    kind: "rankings",
    pageIds: [pageId],
    keywords: ["blue widget"],
    countryCode: "US",
    languageCode: "en",
    devices: ["desktop"],
    maxProviderCalls: 20,
    idempotencyKey: randomUUID(),
  });
const fullAudit = (limited = true) =>
  requestSeoAnalysisSchema.parse({
    kind: "audit_full",
    fullAuditPrice: seoFullAuditPrice(),
    ...(limited && { allowLimitedAudit: true }),
    pageIds: [pageId],
    countryCode: "US",
    languageCode: "en",
    idempotencyKey: randomUUID(),
  });
const counts = async () => ({
  tasks: await prisma.task.count({ where: { workspaceId } }),
  analyses: await prisma.projectSeoAnalysis.count({ where: { auditId } }),
  schedules: await prisma.taskSchedule.count({ where: { workspaceId } }),
});
async function setBalance(credits: bigint) {
  await networkDatabase().creditBucket.deleteMany({ where: { userId } });
  if (credits === 0n) return;
  const topUp = await networkDatabase().transaction.create({
    data: { amount: credits * CREDIT, userId },
    select: { id: true },
  });
  await networkDatabase().creditBucket.create({
    data: { amount: credits * CREDIT, userId, sourceTransactionId: topUp.id },
  });
}

describe.skipIf(!enabled)("SEO credit ceiling at dispatch", () => {
  beforeAll(async () => {
    env.SEO_ANALYSIS_DISPATCH_ENABLED = true;
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
        name: "SEO credit owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.seoAudit.create({
      data: { id: auditId, workspaceId, createdById: userId, name: "Credits" },
    });
    await prisma.vendor.create({
      data: { id: vendorId, slug: vendorId, name: "SEO credit vendor" },
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
      await addProjectSeoPage(actor, {
        url: "https://example.test/credits",
        relationship: "primary",
      })
    ).id;
    secondPageId = (
      await addProjectSeoPage(actor, {
        url: "https://example.test/credits/second",
        relationship: "related",
      })
    ).id;
  });
  beforeEach(async () => {
    await prisma.projectSeoAnalysis.deleteMany({ where: { auditId } });
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.taskSchedule.deleteMany({ where: { workspaceId } });
    await setBalance(0n);
  });
  afterAll(async () => {
    env.SEO_ANALYSIS_EXECUTOR = previousExecutor;
    env.SEO_ANALYSIS_DISPATCH_ENABLED = previousDispatch;
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.taskSchedule.deleteMany({ where: { workspaceId } });
    await networkDatabase().creditBucket.deleteMany({ where: { userId } });
    await networkDatabase().transaction.deleteMany({ where: { userId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.coworker.deleteMany({ where: { vendorId } });
    await prisma.vendor.delete({ where: { id: vendorId } });
  });

  it("refuses a paid check the balance cannot cover and writes nothing", async () => {
    await setBalance(149n);
    const before = await counts();
    await expect(
      requestProjectSeoAnalysis(actor, rankings()),
    ).rejects.toMatchObject({
      status: 422,
      message:
        "Not enough credits. This check requires 150 credits and the balance is 149.",
      cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
    });
    expect(await counts()).toEqual(before);
    await setBalance(150n);
    const analysis = await requestProjectSeoAnalysis(actor, rankings());
    expect(analysis.taskId).not.toBeNull();
  });

  it("refuses unapproved full audit Tasks only in the scoped paid executor's own context", async () => {
    const executor = env.SEO_ANALYSIS_EXECUTOR!;
    if ("mode" in executor) throw new Error("Expected a scoped executor");
    const description = "Audit https://example.test/ without saved SEO scope";
    const task = await prisma.task.create({
      data: {
        name: "Direct SEO Task",
        ownerId: userId,
        workspaceId,
        assigneeId: coworkerId,
        status: "READY",
        description,
      },
    });
    const app = createTaskScheduleTestApp(
      mountTaskEvents,
      { actor: "coworker", coworkerId, vendorId },
      null,
    );
    const start = () =>
      app.request(
        `http://localhost/${task.id}/events`,
        jsonRequest("POST", { status: "RUNNING" }),
      );
    try {
      const denied = await start();
      expect(denied.status).toBe(422);
      expect((await denied.json()).message).toContain(
        "Start this check from an SEO audit",
      );
      expect(await prisma.taskEvent.count({ where: { taskId: task.id } })).toBe(
        0,
      );
      const pageUrls = ["https://example.test/"];
      const full = seoTaskPacket(fullAudit(), pageUrls, randomUUID());
      await prisma.task.update({
        where: { id: task.id },
        data: { description: `seo_audit: ${JSON.stringify(full)}` },
      });
      expect((await start()).status).toBe(422);

      for (const differentScope of [
        { workspaceId: randomUUID() },
        { ownerId: randomUUID() },
        { organizationId: randomUUID() },
        { coworkerId: randomUUID() },
        { canUsePaidSearchData: false },
      ]) {
        env.SEO_ANALYSIS_EXECUTOR = { ...executor, ...differentScope };
        expect((await start()).status).toBe(201);
        await prisma.task.update({
          where: { id: task.id },
          data: { status: "READY" },
        });
      }
      env.SEO_ANALYSIS_EXECUTOR = executor;
      const focused = seoTaskPacket(
        { ...fullAudit(), kind: "page_check", maxProviderCalls: 0 },
        pageUrls,
        randomUUID(),
      );
      await prisma.task.update({
        where: { id: task.id },
        data: { description: `seo_job: ${JSON.stringify(focused)}` },
      });
      expect((await start()).status).toBe(201);
    } finally {
      env.SEO_ANALYSIS_EXECUTOR = executor;
    }
  });

  it("rolls back a goal on insufficient credit and commits a shared first revision once with its Task", async () => {
    const { auditId: id, pages } = await createSeoAudit(actor, {
      name: "Atomic launch",
      firstPage: {
        url: "https://example.test/pricing",
        relationship: "primary",
      },
    });
    const owner = { ...actor, owner: { kind: "audit" as const, id: id! } };
    const page = pages[0];
    const input = {
      ...fullAudit(),
      pageIds: [page.id],
      setupGoal: {
        pageId: page.id,
        expectedRevision: 0,
        action: "buy" as const,
      },
      sharedBrief: { revision: 0, pageIds: [page.id] },
    };
    const evidence = () =>
      prisma.projectSeoObservation.findMany({
        where: {
          auditId: id!,
          kind: { in: ["audit_brief", "audit_brief_run"] },
        },
        select: {
          kind: true,
          payload: true,
          scopeVersion: true,
          visibility: true,
        },
        orderBy: { kind: "asc" },
      });
    await expect(requestProjectSeoAnalysis(owner, input)).rejects.toMatchObject(
      { status: 422 },
    );
    expect(await evidence()).toEqual([]);
    expect(
      await prisma.projectSeoAnalysis.count({ where: { auditId: id! } }),
    ).toBe(0);
    await setBalance(750n);
    const first = await requestProjectSeoAnalysis(owner, input);
    const retry = await requestProjectSeoAnalysis(owner, input);
    expect(retry.taskId).toBe(first.taskId);
    expect(first.request).toMatchObject({
      version: 2,
      context: { pages: [{ url: page.url, action: "buy" }] },
    });
    expect(first.request).not.toHaveProperty("setupGoal");
    expect(await evidence()).toMatchObject([
      {
        kind: "audit_brief",
        visibility: "PRIVATE",
        scopeVersion: 1,
        payload: { pages: [{ pageId: page.id, action: "buy" }] },
      },
      {
        kind: "audit_brief_run",
        visibility: "PRIVATE",
        payload: { revision: 1, sharedPageIds: [page.id] },
      },
    ]);
    await expect(
      requestProjectSeoAnalysis(owner, {
        ...input,
        setupGoal: { ...input.setupGoal, action: "read" },
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      requestProjectSeoAnalysis({ ...owner, sokoBotId: randomUUID() }, input),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("limits a private page-check edit to its scope and preserves other goals and notes", async () => {
    const saved = await createSeoAudit(actor, {
      name: "Private draft",
      firstPage: { url: "https://example.test/docs", relationship: "primary" },
    });
    const owner = {
      ...actor,
      owner: { kind: "audit" as const, id: saved.auditId! },
    };
    const page = saved.pages[0];
    const other = await addProjectSeoPage(owner, {
      url: "https://example.test/shop",
      relationship: "related",
    });
    const content = {
      objective: "support",
      audience: "private-audience",
      outcome: null,
      constraints: null,
      pages: [
        {
          pageId: page.id,
          action: "buy",
          role: "guide",
          job: "private-job",
          indexIntent: "index",
        },
        {
          pageId: other.id,
          action: "sign up",
          role: null,
          job: null,
          indexIntent: "unknown",
        },
      ],
    };
    await saveSeoBrief(owner, { ...content, expectedRevision: 0 });
    const input = requestSeoAnalysisSchema.parse({
      kind: "page_check",
      pageIds: [page.id],
      countryCode: "US",
      languageCode: "en",
      idempotencyKey: randomUUID(),
      setupGoal: { pageId: page.id, expectedRevision: 1, action: "read" },
    });
    await expect(
      requestProjectSeoAnalysis(owner, {
        ...input,
        setupGoal: { ...input.setupGoal!, pageId: other.id },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      requestProjectSeoAnalysis(owner, {
        ...input,
        setupGoal: { ...input.setupGoal!, expectedRevision: 0 },
      }),
    ).rejects.toMatchObject({ status: 409 });
    const run = await requestProjectSeoAnalysis(owner, input);
    expect(run.request).toMatchObject({ version: 1, kind: "page_check" });
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: run.taskId! },
    });
    for (const privateValue of [
      "setupGoal",
      "private-audience",
      "private-job",
      '"action":"read"',
      other.url,
    ])
      expect(task.description).not.toContain(privateValue);
    expect(await getSeoBrief(owner)).toMatchObject({
      ...content,
      revision: 2,
      pages: [{ ...content.pages[0], action: "read" }, content.pages[1]],
    });
    const pin = await prisma.projectSeoObservation.findFirstOrThrow({
      where: { auditId: saved.auditId!, kind: "audit_brief_run" },
    });
    expect(pin.payload).toMatchObject({ revision: 2, sharedPageIds: [] });
  });

  it("requires the fixed 750 credits before a one-page full audit", async () => {
    await setBalance(749n);
    await expect(
      requestProjectSeoAnalysis(actor, fullAudit()),
    ).rejects.toMatchObject({ status: 422 });
    await setBalance(750n);
    expect(
      (await requestProjectSeoAnalysis(actor, fullAudit())).taskId,
    ).not.toBeNull();
  });

  it("requires a Search Console decision before a paid Task exists and replays limited approval once", async () => {
    await setBalance(750n);
    const input = fullAudit(false);
    const before = await counts();
    await expect(requestProjectSeoAnalysis(actor, input)).rejects.toMatchObject(
      {
        status: 409,
        cause: { kind: CORE_API_ERROR_KINDS.SEO_GSC_NOT_CONNECTED },
      },
    );
    expect(await counts()).toEqual(before);
    const limited = { ...input, allowLimitedAudit: true as const };
    const first = await requestProjectSeoAnalysis(actor, limited);
    expect((await requestProjectSeoAnalysis(actor, limited)).id).toBe(first.id);
    expect(await counts()).toEqual({
      ...before,
      tasks: before.tasks + 1,
      analyses: before.analyses + 1,
    });
    expect(first.request).toHaveProperty("searchConsoleAccess", null);
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: first.taskId! },
    });
    expect(task.description).not.toMatch(/searchConsole|allowLimitedAudit/);
  });

  it("rechecks after repair and creates one private approval and one public Task across concurrent retries", async () => {
    const input = {
      ...fullAudit(false),
      searchConsolePropertyId: "https://example.test/",
    };
    await setBalance(750n);
    const before = await counts();
    await expect(requestProjectSeoAnalysis(actor, input)).rejects.toMatchObject(
      {
        cause: { kind: CORE_API_ERROR_KINDS.SEO_GSC_NOT_CONNECTED },
      },
    );
    const connection = await prisma.seoConnection.create({
      data: {
        workspaceId,
        userId,
        provider: "search_console",
        status: "ACTIVE",
        composioAccountId: randomUUID(),
        entityId: randomUUID(),
      },
    });
    const tools = vi
      .spyOn(composio, "listIntegrationTools")
      .mockResolvedValue(searchConsoleToolDescriptors());
    let replaceDuringInspection = true;
    const read = vi
      .spyOn(composio, "readIntegrationTool")
      .mockImplementation(async (_account, slug) => {
        if (slug === GSC_PROPERTIES_TOOL)
          return {
            siteEntry: [
              {
                siteUrl: input.searchConsolePropertyId,
                permissionLevel: "siteOwner",
              },
            ],
          };
        if (slug === GSC_INSPECT_TOOL) {
          if (replaceDuringInspection) {
            replaceDuringInspection = false;
            await prisma.seoConnection.update({
              where: { id: connection.id },
              data: {
                composioAccountId: randomUUID(),
                revision: { increment: 1 },
              },
            });
          }
          return {
            inspectionResult: {
              indexStatusResult: { verdict: "VERDICT_UNSPECIFIED" },
            },
          };
        }
        return { rows: [] };
      });
    try {
      await expect(
        requestProjectSeoAnalysis(actor, input),
      ).rejects.toMatchObject({
        cause: { kind: CORE_API_ERROR_KINDS.SEO_GSC_UNAVAILABLE },
      });
      expect(await counts()).toEqual(before);
      const [first, second] = await Promise.all([
        requestProjectSeoAnalysis(actor, input),
        requestProjectSeoAnalysis(actor, input),
      ]);
      expect(second.id).toBe(first.id);
      expect(await counts()).toEqual({
        ...before,
        tasks: before.tasks + 1,
        analyses: before.analyses + 1,
      });
      expect(first.request).toHaveProperty("searchConsoleAccess", {
        propertyId: input.searchConsolePropertyId,
        connectionVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      const task = await prisma.task.findUniqueOrThrow({
        where: { id: first.taskId! },
      });
      const packet = seoTaskRequestPacket(task.description ?? "", "seo_audit");
      expect(packet).not.toHaveProperty("searchConsoleAccess");
      expect(task.description).not.toContain(
        JSON.stringify(input.searchConsolePropertyId),
      );
      const app = createTaskScheduleTestApp(
        mountTaskEvents,
        { actor: "coworker", coworkerId, vendorId },
        null,
      );
      const start = () =>
        app.request(
          `http://localhost/${task.id}/events`,
          jsonRequest("POST", { status: "RUNNING" }),
        );
      const debits = () =>
        networkDatabase().transaction.count({
          where: { userId, amount: { lt: 0 } },
        });
      const charged = await debits();
      read.mockResolvedValueOnce({ siteEntry: [] });
      const held = await start();
      expect(held.status).toBe(409);
      expect((await held.json()).message).toContain("Review the audit");
      expect(await debits()).toBe(charged);
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
          .status,
      ).toBe("READY");
      const latest = await prisma.taskEvent.findFirstOrThrow({
        where: { taskId: task.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const guarded = () =>
        app.request(
          `http://localhost/${task.id}/events/start-admission-v1`,
          jsonRequest("POST", {
            status: "RUNNING",
            comment: "Starting the approved audit.",
            expectedContext: {
              workspaceId,
              ownerId: userId,
              organizationId: null,
            },
            admission: {
              eventId: latest.id,
              inputFingerprint: createHash("sha256")
                .update(
                  JSON.stringify({
                    description: task.description,
                    name: task.name,
                  }),
                )
                .digest("hex"),
            },
          }),
        );
      // The probe runs outside the transaction. An owner edit can commit here.
      read.mockImplementationOnce(async () => {
        await prisma.task.update({
          where: { id: task.id },
          data: { name: "Edited during inspection" },
        });
        return {
          siteEntry: [
            {
              siteUrl: input.searchConsolePropertyId,
              permissionLevel: "siteOwner",
            },
          ],
        };
      });
      expect((await guarded()).status).toBe(409);
      const edited = await prisma.task.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(edited).toMatchObject({
        name: "Edited during inspection",
        status: "READY",
      });
      expect(
        await prisma.taskEvent.count({
          where: { taskId: task.id, status: "RUNNING" },
        }),
      ).toBe(0);
      const started = await Promise.all([start(), start()]);
      expect(await drainWaitUntil()).toEqual([]);
      expect(
        started.filter((response) => response.status === 201),
      ).toHaveLength(1);
      expect(
        await prisma.taskEvent.count({
          where: { taskId: task.id, status: "RUNNING" },
        }),
      ).toBe(1);
      expect(await debits()).toBe(charged);
      expect(
        await prisma.projectSeoObservation.count({
          where: { sourceTaskId: task.id, kind: AUDIT_PERFORMANCE_KIND },
        }),
      ).toBe(1);
      await prisma.seoConnection.update({
        where: { id: connection.id },
        data: { status: "DISCONNECTED" },
      });
      read.mockClear();
      expect((await requestProjectSeoAnalysis(actor, input)).id).toBe(first.id);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      tools.mockRestore();
      await prisma.seoConnection.delete({ where: { id: connection.id } });
    }
  });

  it("requires the same fixed 750 credits for a multi-page full audit", async () => {
    const twoPages = () => ({
      ...fullAudit(),
      pageIds: [pageId, secondPageId],
    });
    await setBalance(749n);
    await expect(
      requestProjectSeoAnalysis(actor, twoPages()),
    ).rejects.toMatchObject({
      status: 422,
      message:
        "Not enough credits. This check requires 750 credits and the balance is 749.",
    });
    await setBalance(750n);
    expect(
      (await requestProjectSeoAnalysis(actor, twoPages())).taskId,
    ).not.toBeNull();
  });

  it("keeps an approved legacy Task on its quoted terms after the price changes", async () => {
    await setBalance(750n);
    const created = await requestProjectSeoAnalysis(actor, fullAudit());
    const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId: created.taskId! },
    });
    const packet = JSON.parse(JSON.stringify(analysis.request));
    delete packet.price;
    delete packet.searchConsoleAccess;
    delete packet.fullAuditBillingContext;
    await prisma.projectSeoAnalysis.update({
      where: { id: analysis.id },
      data: { request: packet },
    });
    const task = await prisma.task.update({
      where: { id: created.taskId! },
      data: { description: `seo_audit: ${JSON.stringify(packet)}` },
    });
    await setBalance(49n);
    await expect(
      prisma.$transaction((tx) => requireSeoTaskStartBalance(tx, task)),
    ).rejects.toMatchObject({ status: 422 });
    await setBalance(50n);
    await expect(
      prisma.$transaction((tx) => requireSeoTaskStartBalance(tx, task)),
    ).resolves.toBeUndefined();
  });

  it("bills one uncapped full audit at completion from all API receipts and refuses a second debit", async () => {
    await setBalance(1500n);
    const created = await requestProjectSeoAnalysis(actor, fullAudit());
    const taskId = created.taskId!;
    const app = createTaskScheduleTestApp(
      mountTaskEvents,
      { actor: "coworker", coworkerId, vendorId },
      null,
    );
    const post = (path: string, body: Record<string, unknown>) =>
      app.request(
        `http://localhost/${taskId}/events${path}`,
        jsonRequest("POST", body),
      );
    const expectedContext = {
      ownerId: userId,
      organizationId: null,
      workspaceId,
    };
    expect(
      (await post("/context-v1", { status: "RUNNING", expectedContext }))
        .status,
    ).toBe(201);
    const fullAuditCost = {
      version: 1,
      gatewayMicroUsd: 4_000_000,
      directModelMicroUsd: 500_000,
      dataForSeoMicroUsd: 1_499_999,
      otherApiMicroUsd: 2,
    };
    const body = {
      status: "COMPLETED",
      expectedContext,
      credits: 901,
      fullAuditCost,
    };
    const debits = () =>
      networkDatabase().transaction.count({
        where: { userId, amount: { lt: 0 } },
      });
    const before = await debits();
    expect((await post("", { credits: 1 })).status).toBe(422);
    expect((await post("/context-v1", body)).status).toBe(422);
    expect(
      (await post("/seo-settlement-v1", { ...body, credits: 900 })).status,
    ).toBe(422);
    expect(await debits()).toBe(before);
    await setBalance(750n);
    expect((await post("/seo-settlement-v1", body)).status).toBe(422);
    const unpaid = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    expect(unpaid.request).toHaveProperty(
      "pendingFullAuditCost",
      fullAuditCost,
    );
    expect(unpaid.request).not.toHaveProperty("fullAuditCost");
    expect(await debits()).toBe(before);
    await setBalance(1500n);
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "CREDITS_TOPPED_UP" },
    });
    expect(
      (
        await post("/seo-settlement-v1", {
          ...body,
          fullAuditCost: { ...fullAuditCost, otherApiMicroUsd: 3 },
        })
      ).status,
    ).toBe(409);
    const results = await Promise.all([
      post("/seo-settlement-v1", body),
      post("/seo-settlement-v1", body),
    ]);
    expect(
      results.map((r) => r.status).filter((code) => code === 201),
    ).toHaveLength(1);
    expect(await debits()).toBe(before + 1);
    expect(
      await networkDatabase().transaction.findFirst({
        where: { userId, amount: -901n * CREDIT },
      }),
    ).toBeTruthy();
    const stored = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId },
    });
    expect(stored.request).toHaveProperty("fullAuditCost", fullAuditCost);
    const readBilling = (role: "admin" | "user") =>
      createTaskScheduleTestApp(
        mountAdminSeoAlerts,
        { ...vars.authContext, role },
        vars.workspaceContext,
      ).request("http://localhost/seo-alerts?view=billing");
    expect((await readBilling("user")).status).toBe(403);
    const billing = await readBilling("admin");
    expect(billing.status).toBe(200);
    expect((await billing.json()).data.billing).toContainEqual(
      expect.objectContaining({
        taskId,
        status: "settled",
        chargedCredits: 901,
        cost: fullAuditCost,
      }),
    );
    const workspace = await getProjectSeoWorkspace(actor);
    expect(JSON.stringify(workspace)).not.toMatch(
      /fullAuditCost|fullAuditBillingContext|gatewayMicroUsd|directModelMicroUsd/,
    );
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "RUNNING" },
    });
    await setBalance(1500n);
    expect((await post("/seo-settlement-v1", body)).status).toBe(409);
    expect(
      (await post("/context-v1", { status: "COMPLETED", expectedContext }))
        .status,
    ).toBe(201);
    expect(await debits()).toBe(before + 1);
  });

  it("stores the first valid cost detail beside the receipt, drops an invalid one, and never changes the charge", async () => {
    const expectedContext = {
      ownerId: userId,
      organizationId: null,
      workspaceId,
    };
    const fullAuditCost = {
      version: 1,
      gatewayMicroUsd: 4_000_000,
      directModelMicroUsd: 500_000,
      dataForSeoMicroUsd: 1_499_999,
      otherApiMicroUsd: 2,
    };
    const detail = {
      version: 1,
      models: [
        {
          model: "openai/gpt-5",
          provider: "openai",
          calls: 3,
          microUsd: 4_000_000,
        },
        { model: "local-direct", provider: null, calls: 1, microUsd: null },
      ],
      dataForSeo: [
        {
          endpoint: "/v3/serp/google/organic/task_post",
          reads: 2,
          microUsd: 1_499_999,
        },
      ],
      steps: [
        {
          step: "other",
          modelMicroUsd: 4_500_000,
          dataForSeoMicroUsd: 1_499_999,
          otherApiMicroUsd: 2,
        },
      ],
    };
    const settlement = {
      status: "COMPLETED",
      expectedContext,
      credits: 901,
      fullAuditCost,
    };
    const charges = async (taskId: string) => {
      const events = await prisma.taskEvent.findMany({
        where: { taskId, transactionId: { not: null } },
        select: { transactionId: true },
      });
      return networkDatabase().transaction.findMany({
        where: { id: { in: events.map((event) => event.transactionId!) } },
        select: { amount: true },
      });
    };
    const oneCharge = [{ amount: -901n * CREDIT }];
    const storedRequest = async (taskId: string) =>
      (await prisma.projectSeoAnalysis.findUniqueOrThrow({ where: { taskId } }))
        .request as Record<string, unknown>;
    async function runningAudit() {
      await setBalance(1500n);
      const taskId = (await requestProjectSeoAnalysis(actor, fullAudit()))
        .taskId!;
      const app = createTaskScheduleTestApp(
        mountTaskEvents,
        { actor: "coworker", coworkerId, vendorId },
        null,
      );
      const post = (body: Record<string, unknown>) =>
        app.request(
          `http://localhost/${taskId}/events/seo-settlement-v1`,
          jsonRequest("POST", body),
        );
      expect(
        (
          await app.request(
            `http://localhost/${taskId}/events/context-v1`,
            jsonRequest("POST", { status: "RUNNING", expectedContext }),
          )
        ).status,
      ).toBe(201);
      return { taskId, post };
    }
    const readBilling = async () => {
      const response = await createTaskScheduleTestApp(
        mountAdminSeoAlerts,
        { ...vars.authContext, role: "admin" },
        vars.workspaceContext,
      ).request("http://localhost/seo-alerts?view=billing");
      expect(response.status).toBe(200);
      return (await response.json()).data.billing as Record<string, unknown>[];
    };

    // A detail sent while credits are short is kept, and a later different detail does not replace it.
    const first = await runningAudit();
    await setBalance(750n);
    expect(
      (await first.post({ ...settlement, fullAuditCostDetail: detail })).status,
    ).toBe(422);
    expect(await storedRequest(first.taskId)).toMatchObject({
      pendingFullAuditCost: fullAuditCost,
      fullAuditCostDetail: detail,
    });
    await setBalance(1500n);
    await prisma.task.update({
      where: { id: first.taskId },
      data: { status: "CREDITS_TOPPED_UP" },
    });
    const later = { ...detail, models: [] };
    expect(
      (await first.post({ ...settlement, fullAuditCostDetail: later })).status,
    ).toBe(201);
    expect(await charges(first.taskId)).toEqual(oneCharge);
    const settled = await storedRequest(first.taskId);
    expect(settled).toMatchObject({
      fullAuditCost,
      fullAuditCostDetail: detail,
    });
    expect(settled).not.toHaveProperty("pendingFullAuditCost");
    expect(await readBilling()).toContainEqual(
      expect.objectContaining({
        taskId: first.taskId,
        status: "settled",
        cost: fullAuditCost,
        costDetail: detail,
      }),
    );

    // A stored detail that no longer parses reads as absent.
    await prisma.projectSeoAnalysis.update({
      where: { taskId: first.taskId },
      data: { request: { ...settled, fullAuditCostDetail: { version: 2 } } },
    });
    expect(await readBilling()).toContainEqual(
      expect.objectContaining({
        taskId: first.taskId,
        status: "settled",
        costDetail: null,
      }),
    );

    // An unverified row withholds the detail with its cost.
    await prisma.projectSeoAnalysis.update({
      where: { taskId: first.taskId },
      data: {
        request: {
          ...settled,
          fullAuditCost: { ...fullAuditCost, gatewayMicroUsd: 9_000_000 },
        },
      },
    });
    expect(await readBilling()).toContainEqual(
      expect.objectContaining({
        taskId: first.taskId,
        status: "unverified",
        cost: null,
        costDetail: null,
      }),
    );

    const invalid = [
      { ...detail, note: "extra key" },
      {
        ...detail,
        dataForSeo: Array.from({ length: 201 }, () => detail.dataForSeo[0]),
      },
      // PostgreSQL jsonb rejects NUL and an unpaired surrogate, which would roll back the charge.
      {
        ...detail,
        models: [
          { ...detail.models[0], provider: `a${String.fromCharCode(0)}b` },
        ],
      },
      {
        ...detail,
        steps: [{ ...detail.steps[0], step: String.fromCharCode(0xd800) }],
      },
      {
        ...detail,
        dataForSeo: [{ ...detail.dataForSeo[0], microUsd: 1_000_000_000_001 }],
      },
    ];
    for (const fullAuditCostDetail of invalid) {
      const audit = await runningAudit();
      expect(
        (await audit.post({ ...settlement, fullAuditCostDetail })).status,
      ).toBe(201);
      expect(await charges(audit.taskId)).toEqual(oneCharge);
      const stored = await storedRequest(audit.taskId);
      expect(stored).toHaveProperty("fullAuditCost", fullAuditCost);
      expect(stored).not.toHaveProperty("fullAuditCostDetail");
      expect(await readBilling()).toContainEqual(
        expect.objectContaining({
          taskId: audit.taskId,
          status: "settled",
          costDetail: null,
        }),
      );
    }
  });

  it("checks the frozen 750-credit price again before provider work", async () => {
    await setBalance(750n);
    const created = await requestProjectSeoAnalysis(actor, fullAudit());
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: created.taskId! },
    });
    await setBalance(749n);
    await expect(
      prisma.$transaction((tx) => requireSeoTaskStartBalance(tx, task)),
    ).rejects.toMatchObject({ status: 422 });
    await setBalance(750n);
    await expect(
      prisma.$transaction((tx) => requireSeoTaskStartBalance(tx, task)),
    ).resolves.toBeUndefined();
  });

  it("rejects a stale full-audit price acknowledgement before dispatch", async () => {
    await setBalance(1000n);
    const before = await counts();
    const stale = fullAudit();
    delete stale.fullAuditPrice;
    await expect(
      requestProjectSeoAnalysis(actor, { ...stale, fullAuditCredits: 750 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      requestProjectSeoAnalysis(actor, {
        ...stale,
        fullAuditPrice: seoFullAuditPrice(750),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(requestProjectSeoAnalysis(actor, stale)).rejects.toMatchObject(
      { status: 409 },
    );
    expect(await counts()).toEqual(before);
  });

  it("keeps legacy monitor pricing on both scheduled release and Run now", async () => {
    await setBalance(750n);
    const monitor = await createProjectSeoMonitor(vars, actor, {
      operationId: randomUUID(),
      rule: {
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "AFTER",
        targetRunCount: 3,
      },
      analysis: fullAudit(),
    });
    const stored = await prisma.taskSchedule.findUniqueOrThrow({
      where: { id: monitor.id },
    });
    const marker = "seo_monitor: ";
    const legacy = JSON.parse(stored.description!.slice(marker.length));
    expect(legacy.analysis.fullAuditPrice).toEqual(seoFullAuditPrice());
    delete legacy.analysis.fullAuditPrice;
    delete legacy.requiresApprovalRecord;
    const schedule = await prisma.taskSchedule.update({
      where: { id: monitor.id },
      data: { description: marker + JSON.stringify(legacy) },
    });
    await expect(
      createTaskSchedule(vars, {
        operationId: randomUUID(),
        name: "New legacy-price bypass",
        description: schedule.description!,
        visibility: "PUBLIC",
        assigneeId: coworkerId,
        rule: {
          expr: "0 9 * * *",
          timezone: "UTC",
          endsMode: "AFTER",
          targetRunCount: 3,
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    const ordinary = await createTaskSchedule(vars, {
      operationId: randomUUID(),
      name: "Ordinary schedule",
      visibility: "PUBLIC",
      assigneeId: coworkerId,
      rule: {
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "AFTER",
        targetRunCount: 3,
      },
    });
    await expect(
      updateTaskSchedule(vars, ordinary.id, {
        expectedRevision: 0,
        description: schedule.description!,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await setBalance(50n);
    const run = await prisma.taskScheduleRun.findFirstOrThrow({
      where: { scheduleId: monitor.id, state: "PLANNED" },
    });
    const released = await prisma.$transaction((tx) =>
      releaseSeoMonitorRun(tx, schedule, run.id),
    );
    const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId: released!.id },
    });
    expect(analysis.request).not.toHaveProperty("price");
    await prisma.task.update({
      where: { id: released!.id },
      data: { status: "COMPLETED" },
    });
    await expect(
      runTaskScheduleNow(vars, monitor.id, { expectedRevision: 0 }),
    ).rejects.toMatchObject({ cause: { kind: "seo_gsc_not_connected" } });
    const manual = await runTaskScheduleNow(vars, monitor.id, {
      expectedRevision: 0,
      allowLimitedAudit: true,
    });
    const manualAnalysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId: manual.run.releasedTaskId! },
    });
    expect(manualAnalysis.request).not.toHaveProperty("price");
    expect(manualAnalysis.request).toHaveProperty("searchConsoleAccess", null);
  });

  it("checks a monitor at creation and rechecks the balance before each scheduled Run", async () => {
    const input = {
      operationId: randomUUID(),
      rule: {
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "AFTER" as const,
        targetRunCount: 2,
      },
      analysis: rankings(),
    };
    await expect(
      createProjectSeoMonitor(vars, actor, input),
    ).rejects.toMatchObject({ status: 422 });
    expect(await prisma.taskSchedule.count({ where: { workspaceId } })).toBe(0);
    await setBalance(150n);
    const result = await createProjectSeoMonitor(vars, actor, input);
    // A retry whose first reply was lost replays the monitor, though the balance has dropped since.
    await setBalance(0n);
    expect((await createProjectSeoMonitor(vars, actor, input)).id).toBe(
      result.id,
    );
    // The same key with another request is no replay: it is refused and makes no schedule.
    await expect(
      createProjectSeoMonitor(vars, actor, {
        ...input,
        rule: { ...input.rule, targetRunCount: 3 },
      }),
    ).rejects.toMatchObject({
      status: 409,
      cause: { kind: CORE_API_ERROR_KINDS.SCHEDULE_OPERATION_CONFLICT },
    });
    expect(await prisma.taskSchedule.count({ where: { workspaceId } })).toBe(1);
    const schedule = await prisma.taskSchedule.findUniqueOrThrow({
      where: { id: result.id },
    });
    const run = await prisma.taskScheduleRun.findFirstOrThrow({
      where: { scheduleId: schedule.id, state: "PLANNED" },
    });
    await setBalance(0n);
    const before = await counts();
    await expect(
      prisma.$transaction((tx) => releaseSeoMonitorRun(tx, schedule, run.id)),
    ).rejects.toMatchObject({
      status: 422,
      cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
    });
    expect(await counts()).toEqual(before);
    expect(
      (
        await prisma.taskScheduleRun.findUniqueOrThrow({
          where: { id: run.id },
        })
      ).state,
    ).toBe("PLANNED");
    await setBalance(150n);
    const task = await prisma.$transaction((tx) =>
      releaseSeoMonitorRun(tx, schedule, run.id),
    );
    expect(task?.id).toBeDefined();
  });

  it("refuses Run now after credits drop, then permits retry after a top-up", async () => {
    await setBalance(150n);
    const monitor = await createProjectSeoMonitor(vars, actor, {
      operationId: randomUUID(),
      rule: {
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "AFTER",
        targetRunCount: 2,
      },
      analysis: rankings(),
    });
    await setBalance(149n);
    const before = await counts();
    const runsBefore = await prisma.taskScheduleRun.count({
      where: { scheduleId: monitor.id },
    });
    await expect(
      runTaskScheduleNow(vars, monitor.id, { expectedRevision: 0 }),
    ).rejects.toMatchObject({
      status: 422,
      cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
    });
    expect(await counts()).toEqual(before);
    expect(
      await prisma.taskScheduleRun.count({ where: { scheduleId: monitor.id } }),
    ).toBe(runsBefore);
    expect(
      (
        await prisma.taskSchedule.findUniqueOrThrow({
          where: { id: monitor.id },
        })
      ).revision,
    ).toBe(0);
    await setBalance(150n);
    const result = await runTaskScheduleNow(vars, monitor.id, {
      expectedRevision: 0,
    });
    expect(result.run.releasedTaskId).toBeTruthy();
  });
});

describe.skipIf(!enabled)("SEO credit ceiling of a Project's check", () => {
  const memberId = randomUUID(),
    organizationId = randomUUID(),
    orgWorkspaceId = randomUUID(),
    projectId = randomUUID(),
    orgVendorId = randomUUID(),
    orgCoworkerId = randomUUID();
  const projectActor: SeoActor = {
    owner: { kind: "project", id: projectId },
    userId: memberId,
    workspaceId: orgWorkspaceId,
    organizationId,
  };
  let projectPageId: string;
  async function setProjectCredits(credits: bigint) {
    await networkDatabase().creditBucket.deleteMany({
      where: { organizationId },
    });
    const topUp = await networkDatabase().transaction.create({
      data: { amount: credits * CREDIT, organizationId },
      select: { id: true },
    });
    await networkDatabase().creditBucket.create({
      data: {
        amount: credits * CREDIT,
        organizationId,
        projectId,
        sourceTransactionId: topUp.id,
      },
    });
  }

  beforeAll(async () => {
    env.SEO_ANALYSIS_DISPATCH_ENABLED = true;
    env.SEO_ANALYSIS_EXECUTOR = {
      coworkerId: orgCoworkerId,
      workspaceId: orgWorkspaceId,
      ownerId: memberId,
      organizationId,
      canUsePaidSearchData: true,
      canSchedule: true,
    };
    await prisma.user.create({
      data: {
        id: memberId,
        name: "SEO Project member",
        email: `${memberId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "SEO credit organization",
        slug: organizationId,
        workspace: { create: { id: orgWorkspaceId } },
        members: {
          create: [
            { userId: memberId, role: "member", seatAssignedAt: new Date() },
          ],
        },
      },
    });
    await prisma.project.create({
      data: { id: projectId, workspaceId: orgWorkspaceId, name: "Credits" },
    });
    await prisma.vendor.create({
      data: { id: orgVendorId, slug: orgVendorId, name: "SEO Project vendor" },
    });
    await prisma.coworker.create({
      data: {
        id: orgCoworkerId,
        slug: orgCoworkerId,
        name: "SEO Project checks",
        vendorId: orgVendorId,
        isWhitelisted: true,
        capabilities: ["tasks"],
      },
    });
    projectPageId = (
      await addProjectSeoPage(projectActor, {
        url: "https://example.test/project-credits",
        relationship: "primary",
      })
    ).id;
  });
  afterAll(async () => {
    env.SEO_ANALYSIS_EXECUTOR = previousExecutor;
    env.SEO_ANALYSIS_DISPATCH_ENABLED = previousDispatch;
    await prisma.task.deleteMany({ where: { workspaceId: orgWorkspaceId } });
    await networkDatabase().creditBucket.deleteMany({
      where: { organizationId },
    });
    await networkDatabase().transaction.deleteMany({
      where: { organizationId },
    });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: memberId } });
    await prisma.coworker.deleteMany({ where: { vendorId: orgVendorId } });
    await prisma.vendor.delete({ where: { id: orgVendorId } });
    await prisma.$disconnect();
  });

  it("gives another member the same Task start refusal for verified and limited audits", async () => {
    const reader = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "SEO reader",
        email: `${randomUUID()}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        members: {
          create: {
            organizationId,
            role: "member",
            seatAssignedAt: new Date(),
          },
        },
      },
    });
    const app = createTaskScheduleTestApp(
      mountTaskEvents,
      { actor: "user", userId: reader.id, role: "user", organizationId },
      { userId: reader.id, workspaceId: orgWorkspaceId, organizationId },
    );
    await setProjectCredits(750n);
    const analysis = await requestProjectSeoAnalysis(projectActor, {
      ...fullAudit(),
      pageIds: [projectPageId],
    });
    const read = vi.spyOn(composio, "listIntegrationTools");
    try {
      const start = () =>
        app.request(
          `http://localhost/${analysis.taskId}/events`,
          jsonRequest("POST", { status: "RUNNING" }),
        );
      const limited = await start();
      expect(limited.status).toBe(409);
      await prisma.projectSeoAnalysis.update({
        where: { id: analysis.id },
        data: {
          request: {
            ...originalSeoAuditPacket(analysis.request),
            searchConsoleAccess: {
              propertyId: "sc-domain:example.test",
              connectionVersion: "a".repeat(64),
            },
          },
        },
      });
      const verified = await start();
      expect(verified.status).toBe(limited.status);
      expect((await verified.json()).message).toBe(
        (await limited.json()).message,
      );
      expect(
        await prisma.taskEvent.count({
          where: { taskId: analysis.taskId!, status: "RUNNING" },
        }),
      ).toBe(0);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      await prisma.task.delete({ where: { id: analysis.taskId! } });
      await prisma.user.delete({ where: { id: reader.id } });
    }
  });

  it("counts the Project's own credits, which the charge spends first", async () => {
    const check = () => ({ ...rankings(), pageIds: [projectPageId] });
    await setProjectCredits(149n);
    await expect(
      requestProjectSeoAnalysis(projectActor, check()),
    ).rejects.toMatchObject({ status: 422 });
    // The Organization pool is empty: only the Project's credits can cover this check.
    await setProjectCredits(150n);
    expect(
      (await requestProjectSeoAnalysis(projectActor, check())).taskId,
    ).not.toBeNull();
  });
});
