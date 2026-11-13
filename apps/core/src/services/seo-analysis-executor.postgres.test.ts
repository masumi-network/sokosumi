import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { parseSeoMonitorPlan } from "@/lib/seo/monitor-plan";
import {
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import {
  addProjectSeoPage,
  getProjectSeoWorkspace,
} from "./project-seo.service";
import {
  createProjectSeoMonitor,
  releaseSeoMonitorRun,
} from "./project-seo-monitor.service";
import { requestProjectSeoAnalysis } from "./project-seo-operations.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID(),
  workspaceId = randomUUID(),
  auditId = randomUUID(),
  vendorId = randomUUID(),
  coworkerId = randomUUID(),
  otherCoworkerId = randomUUID();
const actor: SeoActor = {
  owner: { kind: "audit", id: auditId },
  userId,
  workspaceId,
  organizationId: null,
};
const trusted = {
  coworkerId,
  workspaceId,
  ownerId: userId,
  organizationId: null,
  canUsePaidSearchData: false,
  canSchedule: true,
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
const request = () =>
  requestSeoAnalysisSchema.parse({
    kind: "page_check",
    pageIds: [pageId],
    countryCode: "US",
    languageCode: "en",
    devices: ["desktop"],
    maxProviderCalls: 20,
    idempotencyKey: randomUUID(),
  });
const monitor = (analysis = request()) => ({
  operationId: randomUUID(),
  rule: {
    expr: "0 9 * * *",
    timezone: "UTC",
    endsMode: "AFTER" as const,
    targetRunCount: 2,
  },
  analysis,
});
async function counts() {
  return {
    tasks: await prisma.task.count({ where: { workspaceId } }),
    analyses: await prisma.projectSeoAnalysis.count({ where: { auditId } }),
    schedules: await prisma.taskSchedule.count({ where: { workspaceId } }),
  };
}

describe.skipIf(!enabled)("Native SEO trusted executor with PostgreSQL", () => {
  beforeAll(async () => {
    env.SEO_ANALYSIS_DISPATCH_ENABLED = true;
    env.SEO_ANALYSIS_EXECUTOR = trusted;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Native executor owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.seoAudit.create({
      data: {
        id: auditId,
        workspaceId,
        createdById: userId,
        name: "Native executor acceptance",
      },
    });
    await prisma.vendor.create({
      data: { id: vendorId, slug: vendorId, name: "Native executor vendor" },
    });
    await prisma.coworker.createMany({
      data: [coworkerId, otherCoworkerId].map((id) => ({
        id,
        slug: id,
        name: "Task executor",
        vendorId,
        isWhitelisted: true,
        capabilities: ["tasks"],
      })),
    });
    pageId = (
      await addProjectSeoPage(actor, {
        url: "https://example.test/native-executor",
        relationship: "primary",
      })
    ).id;
  });
  afterAll(async () => {
    env.SEO_ANALYSIS_EXECUTOR = previousExecutor;
    env.SEO_ANALYSIS_DISPATCH_ENABLED = previousDispatch;
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.creditBucket.deleteMany({ where: { userId } });
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.coworker.deleteMany({ where: { vendorId } });
    await prisma.vendor.delete({ where: { id: vendorId } });
    await prisma.$disconnect();
  });

  it("fails closed without an exact configured context and writes no analysis Task or schedule", async () => {
    const before = await counts();
    try {
      for (const executor of [
        undefined,
        { ...trusted, ownerId: randomUUID() },
        { ...trusted, workspaceId: randomUUID() },
        { ...trusted, organizationId: randomUUID() },
        { ...trusted, coworkerId: randomUUID() },
      ]) {
        env.SEO_ANALYSIS_EXECUTOR = executor;
        expect(
          (await getProjectSeoWorkspace(actor)).availableActions,
        ).toMatchObject({
          canRequestAnalysis: false,
          canUsePaidSearchData: false,
        });
        await expect(
          requestProjectSeoAnalysis(actor, { ...request(), coworkerId }),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          createProjectSeoMonitor(
            vars,
            actor,
            monitor({ ...request(), coworkerId }),
          ),
        ).rejects.toMatchObject({ status: 409 });
        expect(await counts()).toEqual(before);
      }
    } finally {
      env.SEO_ANALYSIS_EXECUTOR = trusted;
    }
  });

  it("selects the trusted executor without an imported report or caller ID and pins HTML packets to zero provider calls", async () => {
    expect(
      (await getProjectSeoWorkspace(actor)).availableActions,
    ).toMatchObject({ canRequestAnalysis: true, canUsePaidSearchData: false });
    for (const input of [
      request(),
      {
        ...request(),
        kind: "audit_lite" as const,
        analyses: ["page.inspect" as const],
      },
    ]) {
      const analysis = await requestProjectSeoAnalysis(actor, input);
      expect(
        await prisma.task.findUniqueOrThrow({
          where: { id: analysis.taskId! },
        }),
      ).toMatchObject({
        assigneeId: coworkerId,
        ownerId: userId,
        workspaceId,
        organizationId: null,
      });
      expect(analysis.request).toMatchObject({
        budget: { maxProviderCalls: 0 },
      });
    }
  });

  it("rejects unrelated executor IDs and paid modules or full audits before any Task or schedule writes", async () => {
    const before = await counts();
    const paid = [
      { ...request(), coworkerId: otherCoworkerId },
      { ...request(), kind: "rankings" as const, keywords: ["native search"] },
      { ...request(), kind: "links" as const },
      {
        ...request(),
        kind: "audit_lite" as const,
        analyses: ["keyword.refresh" as const],
        keywords: ["native search"],
      },
      {
        ...request(),
        kind: "audit_full" as const,
        devices: ["mobile" as const, "desktop" as const],
      },
    ];
    for (const input of paid) {
      await expect(
        requestProjectSeoAnalysis(actor, input),
      ).rejects.toMatchObject({ status: 409 });
      if (input.kind !== "audit_full")
        await expect(
          createProjectSeoMonitor(vars, actor, monitor(input)),
        ).rejects.toMatchObject({ status: 409 });
    }
    expect(await counts()).toEqual(before);
    env.SEO_ANALYSIS_EXECUTOR = { ...trusted, canUsePaidSearchData: true };
    // A paid check needs a balance that covers its ceiling (seo-credit-gate.postgres.test.ts).
    const credits = 10_000n * 10n ** 10n;
    const topUp = await prisma.transaction.create({
      data: { amount: credits, userId },
      select: { id: true },
    });
    await prisma.creditBucket.create({
      data: { amount: credits, userId, sourceTransactionId: topUp.id },
    });
    try {
      expect(
        (await getProjectSeoWorkspace(actor)).availableActions
          .canUsePaidSearchData,
      ).toBe(true);
      for (const input of paid.slice(1)) {
        const analysis = await requestProjectSeoAnalysis(actor, input);
        expect(
          await prisma.task.findUniqueOrThrow({
            where: { id: analysis.taskId! },
          }),
        ).toMatchObject({ assigneeId: coworkerId });
      }
    } finally {
      env.SEO_ANALYSIS_EXECUTOR = trusted;
    }
  });

  it("returns a committed request replay after executor removal and still gates new requests on current Workspace usability", async () => {
    const input = request();
    const result = await requestProjectSeoAnalysis(actor, input);
    const before = await counts();
    env.SEO_ANALYSIS_EXECUTOR = undefined;
    try {
      expect((await requestProjectSeoAnalysis(actor, input)).id).toBe(
        result.id,
      );
      await expect(
        requestProjectSeoAnalysis(actor, request()),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      env.SEO_ANALYSIS_EXECUTOR = trusted;
    }
    await prisma.coworker.update({
      where: { id: coworkerId },
      data: { isWhitelisted: false },
    });
    try {
      expect(
        (await getProjectSeoWorkspace(actor)).availableActions
          .canRequestAnalysis,
      ).toBe(false);
      await expect(
        requestProjectSeoAnalysis(actor, request()),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await prisma.coworker.update({
        where: { id: coworkerId },
        data: { isWhitelisted: true },
      });
    }
    expect(await counts()).toEqual(before);
  });

  it("freezes the resolved executor in a finite plan and refuses configuration rotation before fresh Run writes", async () => {
    const input = monitor();
    const result = await createProjectSeoMonitor(vars, actor, input);
    expect((await createProjectSeoMonitor(vars, actor, input)).id).toBe(
      result.id,
    );
    const schedule = await prisma.taskSchedule.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(schedule.assigneeId).toBe(coworkerId);
    expect(parseSeoMonitorPlan(schedule.description)?.analysis).toMatchObject({
      coworkerId,
      maxProviderCalls: 0,
    });
    const runs = await prisma.taskScheduleRun.findMany({
      where: { scheduleId: schedule.id, state: "PLANNED" },
      orderBy: { effectiveScheduledAt: "asc" },
    });
    expect(runs).toHaveLength(2);
    const before = await counts();
    env.SEO_ANALYSIS_EXECUTOR = { ...trusted, coworkerId: otherCoworkerId };
    try {
      await expect(
        prisma.$transaction((tx) =>
          releaseSeoMonitorRun(tx, schedule, runs[0].id),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await counts()).toEqual(before);
    } finally {
      env.SEO_ANALYSIS_EXECUTOR = trusted;
    }
    const first = await prisma.$transaction((tx) =>
      releaseSeoMonitorRun(tx, schedule, runs[0].id),
    );
    const replay = await prisma.$transaction((tx) =>
      releaseSeoMonitorRun(tx, schedule, runs[0].id),
    );
    const second = await prisma.$transaction((tx) =>
      releaseSeoMonitorRun(tx, schedule, runs[1].id),
    );
    expect(replay?.id).toBe(first?.id);
    expect(second?.id).not.toBe(first?.id);
    await expect(
      prisma.$transaction((tx) =>
        releaseSeoMonitorRun(tx, schedule, randomUUID()),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await prisma.task.count({ where: { scheduleId: schedule.id } }),
    ).toBe(2);
  });
  it("keeps one-off checks available while an unapproved scheduler blocks monitor creation and future finite Runs", async () => {
    const result = await createProjectSeoMonitor(vars, actor, monitor());
    const schedule = await prisma.taskSchedule.findUniqueOrThrow({
      where: { id: result.id },
    });
    const run = await prisma.taskScheduleRun.findFirstOrThrow({
      where: { scheduleId: schedule.id, state: "PLANNED" },
    });
    env.SEO_ANALYSIS_EXECUTOR = { ...trusted, canSchedule: false };
    const before = await counts();
    try {
      expect(
        (await getProjectSeoWorkspace(actor)).availableActions,
      ).toMatchObject({ canRequestAnalysis: true, canCreateMonitor: false });
      await expect(
        createProjectSeoMonitor(vars, actor, monitor()),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        prisma.$transaction((tx) => releaseSeoMonitorRun(tx, schedule, run.id)),
      ).rejects.toMatchObject({ status: 409 });
      expect(await counts()).toEqual(before);
      const analysis = await requestProjectSeoAnalysis(actor, request());
      expect(analysis.taskId).not.toBeNull();
    } finally {
      env.SEO_ANALYSIS_EXECUTOR = trusted;
    }
  });
});
