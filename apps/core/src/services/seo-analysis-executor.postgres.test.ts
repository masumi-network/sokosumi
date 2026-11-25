import { randomUUID } from "node:crypto";
import { CORE_API_ERROR_KINDS, seoFullAuditPrice } from "@sokosumi/utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { findSeoAnalysisExecutor } from "@/lib/seo/analysis-dispatch";
import { requireSeoTaskStartBalance } from "@/lib/seo/analysis-price";
import { parseSeoMonitorPlan } from "@/lib/seo/monitor-plan";
import {
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import { testNetworkScope } from "@/test-fixtures/network-scope";
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
const mainnetCoworkerId = "1d7aeb62-1f65-4c5a-b4d3-f80faa08e80f";
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
const organizationUserId = randomUUID(),
  organizationId = randomUUID(),
  organizationWorkspaceId = randomUUID(),
  organizationAuditId = randomUUID();
const organizationActor: SeoActor = {
  owner: { kind: "audit", id: organizationAuditId },
  workspaceId: organizationWorkspaceId,
  userId: organizationUserId,
  organizationId,
};
const globalExecutor = {
  mode: "global" as const,
  coworkerId,
  canUsePaidSearchData: false,
  canSchedule: true,
};
let organizationPageId: string;
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

async function withMainnetDefault(run: () => Promise<void>) {
  const previous = {
    NETWORK: env.NETWORK,
    VERCEL_ENV: env.VERCEL_ENV,
    SEO_ANALYSIS_EXECUTOR: env.SEO_ANALYSIS_EXECUTOR,
    SEO_ANALYSIS_DISPATCH_ENABLED: env.SEO_ANALYSIS_DISPATCH_ENABLED,
  };
  const flag = process.env.SEO_ANALYSIS_DISPATCH_ENABLED;
  env.NETWORK = "Mainnet";
  env.VERCEL_ENV = "production";
  env.SEO_ANALYSIS_EXECUTOR = undefined;
  env.SEO_ANALYSIS_DISPATCH_ENABLED = false;
  delete process.env.SEO_ANALYSIS_DISPATCH_ENABLED;
  try {
    await run();
  } finally {
    Object.assign(env, previous);
    if (flag === undefined) delete process.env.SEO_ANALYSIS_DISPATCH_ENABLED;
    else process.env.SEO_ANALYSIS_DISPATCH_ENABLED = flag;
  }
}

describe.skipIf(!enabled)("Native SEO trusted executor with PostgreSQL", () => {
  beforeAll(async () => {
    // Do not modify a registry row inherited from another database fixture.
    expect(
      await prisma.coworker.count({ where: { id: mainnetCoworkerId } }),
    ).toBe(0);
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
    await prisma.user.create({
      data: {
        id: organizationUserId,
        name: "Organization executor owner",
        email: `${organizationUserId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        slug: organizationId,
        name: "Global SEO organization",
        workspace: { create: { id: organizationWorkspaceId } },
        members: {
          create: {
            userId: organizationUserId,
            role: "owner",
            seatAssignedAt: new Date(),
          },
        },
      },
    });
    await prisma.seoAudit.create({
      data: {
        id: organizationAuditId,
        workspaceId: organizationWorkspaceId,
        createdById: organizationUserId,
        name: "Global organization audit",
      },
    });
    organizationPageId = (
      await addProjectSeoPage(organizationActor, {
        url: "https://example.test/organization",
        relationship: "primary",
      })
    ).id;
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
      data: [coworkerId, otherCoworkerId, mainnetCoworkerId].map((id) => ({
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
  beforeEach(async () => {
    // Each case starts after earlier dispatched checks have finished.
    const earlier = await prisma.projectSeoAnalysis.findMany({
      where: { requestedBy: userId },
      select: { taskId: true },
    });
    await prisma.task.updateMany({
      where: {
        id: { in: earlier.flatMap((row) => (row.taskId ? [row.taskId] : [])) },
        status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] },
      },
      data: { status: "COMPLETED" },
    });
  });
  afterAll(async () => {
    env.SEO_ANALYSIS_EXECUTOR = previousExecutor;
    env.SEO_ANALYSIS_DISPATCH_ENABLED = previousDispatch;
    await prisma.task.deleteMany({
      where: { workspaceId: { in: [workspaceId, organizationWorkspaceId] } },
    });
    await prisma.creditBucket.deleteMany({
      where: {
        OR: [
          { userId: { in: [userId, organizationUserId] } },
          { organizationId },
        ],
      },
    });
    await prisma.transaction.deleteMany({
      where: {
        OR: [
          { userId: { in: [userId, organizationUserId] } },
          { organizationId },
        ],
      },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, organizationWorkspaceId] } },
    });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, organizationUserId] } },
    });
    await prisma.coworker.deleteMany({ where: { vendorId } });
    await prisma.vendor.delete({ where: { id: vendorId } });
    await prisma.$disconnect();
  });

  it("uses the live Mainnet default without custom variables and retains each Task payer", async () => {
    await withMainnetDefault(async () => {
      for (const [currentActor, selectedPage] of [
        [actor, pageId],
        [organizationActor, organizationPageId],
      ] as const) {
        expect(
          (await getProjectSeoWorkspace(currentActor)).availableActions,
        ).toMatchObject({
          canRequestAnalysis: true,
          canUsePaidSearchData: true,
          canCreateMonitor: true,
        });
        const analysis = await requestProjectSeoAnalysis(currentActor, {
          ...request(),
          pageIds: [selectedPage],
        });
        const task = await prisma.task.findUniqueOrThrow({
          where: { id: analysis.taskId! },
        });
        expect(task).toMatchObject({
          assigneeId: mainnetCoworkerId,
          ownerId: currentActor.userId,
          workspaceId: currentActor.workspaceId,
          organizationId: currentActor.organizationId,
        });
        await prisma.$transaction((tx) => requireSeoTaskStartBalance(tx, task));
        await prisma.task.update({
          where: { id: task.id },
          data: { status: "COMPLETED" },
        });
      }
    });
  });

  it("keeps Mainnet defaults unavailable on Preview and without current registry usability", async () => {
    await withMainnetDefault(async () => {
      for (const [network, deployment] of [
        ["Mainnet", "preview"],
        ["Preprod", "production"],
      ] as const) {
        env.NETWORK = network;
        env.VERCEL_ENV = deployment;
        expect(await findSeoAnalysisExecutor(actor)).toBeNull();
      }
      env.NETWORK = "Mainnet";
      env.VERCEL_ENV = "production";
      for (const paused of [
        { capabilities: [] },
        { archivedAt: new Date() },
        { isWhitelisted: false },
      ]) {
        await prisma.coworker.update({
          where: { id: mainnetCoworkerId },
          data: paused,
        });
        try {
          expect(await findSeoAnalysisExecutor(actor)).toBeNull();
          await expect(
            requestProjectSeoAnalysis(actor, request()),
          ).rejects.toMatchObject({ status: 409 });
        } finally {
          await prisma.coworker.update({
            where: { id: mainnetCoworkerId },
            data: {
              capabilities: ["tasks"],
              archivedAt: null,
              isWhitelisted: true,
            },
          });
        }
      }
      for (const status of ["DENIED", "REVOKED"] as const) {
        const grant = await prisma.vendorGrant.create({
          data: { vendorId, workspaceId, permission: "workspace", status },
        });
        try {
          expect(await findSeoAnalysisExecutor(actor)).toBeNull();
          expect(
            await findSeoAnalysisExecutor(organizationActor),
          ).toMatchObject({
            coworkerId: mainnetCoworkerId,
          });
        } finally {
          await prisma.vendorGrant.delete({ where: { id: grant.id } });
        }
      }
    });
  });

  it("refuses unlinked or forged Tasks assigned to the default Mainnet service, even while paused", async () => {
    await withMainnetDefault(async () => {
      const task = await prisma.task.create({
        data: {
          name: "Unapproved direct SEO Task",
          ownerId: userId,
          workspaceId,
          assigneeId: mainnetCoworkerId,
          status: "READY",
        },
      });
      await prisma.coworker.update({
        where: { id: mainnetCoworkerId },
        data: { capabilities: [] },
      });
      try {
        for (const description of [
          "https://example.test/unapproved",
          'seo_job: {"pageUrls":["https://example.test/unapproved"],"budget":{"maxProviderCalls":20}}',
        ]) {
          const current = await prisma.task.update({
            where: { id: task.id },
            data: { description },
          });
          await expect(
            prisma.$transaction((tx) =>
              requireSeoTaskStartBalance(tx, current),
            ),
          ).rejects.toMatchObject({ status: 422 });
        }
        expect(
          await prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
        ).toMatchObject({ status: "READY" });
      } finally {
        await prisma.coworker.update({
          where: { id: mainnetCoworkerId },
          data: { capabilities: ["tasks"] },
        });
      }
    });
  });

  it("uses one explicit global service while keeping each personal and organization Task context", async () => {
    env.SEO_ANALYSIS_EXECUTOR = globalExecutor;
    try {
      for (const [currentActor, selectedPage] of [
        [actor, pageId],
        [organizationActor, organizationPageId],
      ] as const) {
        expect(
          (await getProjectSeoWorkspace(currentActor)).availableActions
            .canRequestAnalysis,
        ).toBe(true);
        const analysis = await requestProjectSeoAnalysis(currentActor, {
          ...request(),
          pageIds: [selectedPage],
        });
        expect(
          await prisma.task.findUniqueOrThrow({
            where: { id: analysis.taskId! },
          }),
        ).toMatchObject({
          assigneeId: coworkerId,
          ownerId: currentActor.userId,
          workspaceId: currentActor.workspaceId,
          organizationId: currentActor.organizationId,
        });
        expect(analysis.request).toMatchObject({
          budget: { maxProviderCalls: 0 },
        });
        await prisma.task.update({
          where: { id: analysis.taskId! },
          data: { status: "COMPLETED" },
        });
      }
    } finally {
      env.SEO_ANALYSIS_EXECUTOR = trusted;
    }
  });
  it("keeps global service availability scoped to current workspace access and vendor denial", async () => {
    env.SEO_ANALYSIS_EXECUTOR = globalExecutor;
    try {
      for (const status of ["DENIED", "REVOKED"] as const) {
        const grant = await prisma.vendorGrant.create({
          data: { vendorId, workspaceId, permission: "workspace", status },
        });
        try {
          expect(await findSeoAnalysisExecutor(actor)).toBeNull();
          expect(await findSeoAnalysisExecutor(organizationActor)).toEqual(
            globalExecutor,
          );
          await expect(
            requestProjectSeoAnalysis(actor, request()),
          ).rejects.toMatchObject({ status: 409 });
        } finally {
          await prisma.vendorGrant.delete({ where: { id: grant.id } });
        }
      }
      await prisma.coworker.update({
        where: { id: coworkerId },
        data: { isWhitelisted: false },
      });
      const access = await prisma.coworkerWorkspaceAccess.create({
        data: {
          coworkerId,
          workspaceId: organizationWorkspaceId,
          status: "GRANTED",
        },
      });
      try {
        expect(await findSeoAnalysisExecutor(actor)).toBeNull();
        expect(await findSeoAnalysisExecutor(organizationActor)).toEqual(
          globalExecutor,
        );
        await prisma.coworkerWorkspaceAccess.update({
          where: { id: access.id },
          data: { status: "REVOKED" },
        });
        expect(await findSeoAnalysisExecutor(organizationActor)).toBeNull();
      } finally {
        await prisma.coworkerWorkspaceAccess.delete({
          where: { id: access.id },
        });
        await prisma.coworker.update({
          where: { id: coworkerId },
          data: { isWhitelisted: true },
        });
      }
    } finally {
      env.SEO_ANALYSIS_EXECUTOR = trusted;
    }
  });
  it("charges each global caller's credit context and keeps scheduling approval separate", async () => {
    env.SEO_ANALYSIS_EXECUTOR = {
      ...globalExecutor,
      canUsePaidSearchData: true,
      canSchedule: false,
    };
    const credits = 10_000n * 10n ** 10n;
    const personalTopUp = await prisma.transaction.create({
      data: { amount: credits, userId },
      select: { id: true },
    });
    const personalBucket = await prisma.creditBucket.create({
      data: { amount: credits, userId, sourceTransactionId: personalTopUp.id },
      select: { id: true },
    });
    let organizationBucket: string | undefined;
    let organizationTransaction: string | undefined;
    try {
      const before = await prisma.task.count({
        where: { workspaceId: organizationWorkspaceId },
      });
      const paid = {
        ...request(),
        pageIds: [organizationPageId],
        kind: "rankings" as const,
        keywords: ["global native search"],
      };
      await expect(
        requestProjectSeoAnalysis(organizationActor, paid),
      ).rejects.toMatchObject({
        status: 422,
        cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
      });
      expect(
        await prisma.task.count({
          where: { workspaceId: organizationWorkspaceId },
        }),
      ).toBe(before);
      expect(
        (await getProjectSeoWorkspace(organizationActor)).availableActions,
      ).toMatchObject({
        canRequestAnalysis: true,
        canUsePaidSearchData: true,
        canCreateMonitor: false,
      });
      const orgTopUp = await prisma.transaction.create({
        data: { amount: credits, userId: organizationUserId, organizationId },
        select: { id: true },
      });
      organizationTransaction = orgTopUp.id;
      organizationBucket = (
        await prisma.creditBucket.create({
          data: {
            amount: credits,
            organizationId,
            sourceTransactionId: orgTopUp.id,
          },
          select: { id: true },
        })
      ).id;
      const result = await requestProjectSeoAnalysis(organizationActor, paid);
      expect(
        await prisma.task.findUniqueOrThrow({ where: { id: result.taskId! } }),
      ).toMatchObject({
        ownerId: organizationUserId,
        organizationId,
        workspaceId: organizationWorkspaceId,
        assigneeId: coworkerId,
      });
      await prisma.task.update({
        where: { id: result.taskId! },
        data: { status: "COMPLETED" },
      });
      await expect(
        createProjectSeoMonitor(vars, actor, monitor()),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      env.SEO_ANALYSIS_EXECUTOR = trusted;
      await prisma.creditBucket.delete({ where: { id: personalBucket.id } });
      await prisma.transaction.delete({ where: { id: personalTopUp.id } });
      if (organizationBucket)
        await prisma.creditBucket.delete({ where: { id: organizationBucket } });
      if (organizationTransaction)
        await prisma.transaction.delete({
          where: { id: organizationTransaction },
        });
    }
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
      await prisma.task.update({
        where: { id: analysis.taskId! },
        data: { status: "COMPLETED" },
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
        fullAuditPrice: seoFullAuditPrice(),
        allowLimitedAudit: true as const,
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
        await prisma.task.update({
          where: { id: analysis.taskId! },
          data: { status: "COMPLETED" },
        });
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
    await prisma.task.update({
      where: { id: first!.id },
      data: { status: "COMPLETED" },
    });
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
