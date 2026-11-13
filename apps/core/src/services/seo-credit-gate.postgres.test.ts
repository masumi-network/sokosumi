import { randomUUID } from "node:crypto";
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
let pageId: string;
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
    await prisma.$disconnect();
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
    });
    expect(await counts()).toEqual(before);
    await setBalance(150n);
    const analysis = await requestProjectSeoAnalysis(actor, rankings());
    expect(analysis.taskId).not.toBeNull();
  });

  it("bounds a one-page full audit by its 45-credit page ceiling", async () => {
    await setBalance(44n);
    await expect(
      requestProjectSeoAnalysis(actor, fullAudit()),
    ).rejects.toMatchObject({ status: 422 });
    await setBalance(45n);
    expect(
      (await requestProjectSeoAnalysis(actor, fullAudit())).taskId,
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
