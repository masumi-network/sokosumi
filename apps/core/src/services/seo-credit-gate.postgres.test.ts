import { randomUUID } from "node:crypto";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
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
  beforeEach(() => setBalance(0n));
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
        "Not enough credits. This check costs up to 150 credits and the balance is 149.",
      cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
    });
    expect(await counts()).toEqual(before);
    await setBalance(150n);
    const analysis = await requestProjectSeoAnalysis(actor, rankings());
    expect(analysis.taskId).not.toBeNull();
  });

  it("bounds a one-page full audit by its 47-credit page ceiling", async () => {
    await setBalance(46n);
    await expect(
      requestProjectSeoAnalysis(actor, fullAudit()),
    ).rejects.toMatchObject({ status: 422 });
    await setBalance(47n);
    expect(
      (await requestProjectSeoAnalysis(actor, fullAudit())).taskId,
    ).not.toBeNull();
  });

  it("bounds a multi-page full audit by its default USD 3 limit, 450 credits", async () => {
    const twoPages = () => ({
      ...fullAudit(),
      pageIds: [pageId, secondPageId],
    });
    await setBalance(449n);
    await expect(
      requestProjectSeoAnalysis(actor, twoPages()),
    ).rejects.toMatchObject({
      status: 422,
      message:
        "Not enough credits. This check costs up to 450 credits and the balance is 449.",
    });
    await setBalance(450n);
    expect(
      (await requestProjectSeoAnalysis(actor, twoPages())).taskId,
    ).not.toBeNull();
  });

  it("checks a monitor's first Run when it is made, but never holds a scheduled Run", async () => {
    const input = {
      operationId: randomUUID(),
      cadence: "daily" as const,
      timeZone: "UTC",
      targetRunCount: 2,
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
      createProjectSeoMonitor(vars, actor, { ...input, targetRunCount: 3 }),
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
    const task = await prisma.$transaction((tx) =>
      releaseSeoMonitorRun(tx, schedule, run.id),
    );
    expect(task?.id).toBeDefined();
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
