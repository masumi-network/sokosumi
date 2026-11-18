import { randomUUID } from "node:crypto";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
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
import {
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import { addProjectSeoPage } from "./project-seo.service";
import {
  createProjectSeoMonitor,
  releaseSeoMonitorRun,
} from "./project-seo-monitor.service";
import { requestProjectSeoAnalysis } from "./project-seo-operations.service";
import { createSeoAudit } from "./seo-audit.service";
import { getSeoBrief, saveSeoBrief } from "./seo-audit-brief.service";
import {
  createTaskSchedule,
  runTaskScheduleNow,
  updateTaskSchedule,
} from "./task-schedule.service";

// The flow publishes over Ably; the test env has no real key.
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
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
const fullAudit = () =>
  requestSeoAnalysisSchema.parse({
    kind: "audit_full",
    fullAuditCredits: 750,
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
  await prisma.creditBucket.deleteMany({ where: { userId } });
  if (credits === 0n) return;
  const topUp = await prisma.transaction.create({
    data: { amount: credits * CREDIT, userId },
    select: { id: true },
  });
  await prisma.creditBucket.create({
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
    await prisma.creditBucket.deleteMany({ where: { userId } });
    await prisma.transaction.deleteMany({ where: { userId } });
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
    delete stale.fullAuditCredits;
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
    expect(legacy.analysis.fullAuditCredits).toBe(750);
    delete legacy.analysis.fullAuditCredits;
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
    const manual = await runTaskScheduleNow(vars, monitor.id, {
      expectedRevision: 0,
    });
    const manualAnalysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: { taskId: manual.run.releasedTaskId! },
    });
    expect(manualAnalysis.request).not.toHaveProperty("price");
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
    await prisma.creditBucket.deleteMany({ where: { organizationId } });
    const topUp = await prisma.transaction.create({
      data: { amount: credits * CREDIT, organizationId },
      select: { id: true },
    });
    await prisma.creditBucket.create({
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
    await prisma.creditBucket.deleteMany({ where: { organizationId } });
    await prisma.transaction.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: memberId } });
    await prisma.coworker.deleteMany({ where: { vendorId: orgVendorId } });
    await prisma.vendor.delete({ where: { id: orgVendorId } });
    await prisma.$disconnect();
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
