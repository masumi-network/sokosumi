import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getEnv } from "@/config/env";
import { requireTaskWorkerContext } from "@/helpers/task-worker-context";
import prisma from "@/lib/db/prisma";
import { requireSeoTaskStartBalance } from "@/lib/seo/analysis-price";
import {
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import { focusedReport, SEO_TEST_PAGE } from "@/test-fixtures/project-seo";
import { addProjectSeoPage } from "./project-seo.service";
import {
  importProjectSeoAudit,
  reconcileProjectSeoTaskFile,
} from "./project-seo-import.service";
import {
  createProjectSeoMonitor,
  releaseSeoMonitorRun,
} from "./project-seo-monitor.service";
import { requestProjectSeoAnalysis } from "./project-seo-operations.service";
import { closeTaskScheduleForProject } from "./task-schedule-runs.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID(),
  workspaceId = randomUUID(),
  vendorId = randomUUID(),
  coworkerId = randomUUID();
const env = getEnv(),
  previousExecutor = env.SEO_ANALYSIS_EXECUTOR,
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

describe.skipIf(!enabled)("SEO work owed before Project closure", () => {
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
        name: "SEO close owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.vendor.create({
      data: { id: vendorId, slug: vendorId, name: "SEO close vendor" },
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
  });
  afterAll(async () => {
    env.SEO_ANALYSIS_EXECUTOR = previousExecutor;
    env.SEO_ANALYSIS_DISPATCH_ENABLED = previousDispatch;
    vi.unstubAllGlobals();
    await prisma.creditBucket.deleteMany({ where: { userId } });
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.taskSchedule.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.coworker.delete({ where: { id: coworkerId } });
    await prisma.vendor.delete({ where: { id: vendorId } });
    await prisma.$disconnect();
  });

  async function fixture(kind: "project" | "audit", paid = false) {
    const project = await prisma.project.create({
      data: { workspaceId, name: "SEO closing project" },
    });
    const audit =
      kind === "audit"
        ? await prisma.seoAudit.create({
            data: {
              projectId: project.id,
              workspaceId,
              createdById: userId,
              name: "Linked SEO audit",
            },
          })
        : null;
    const actor: SeoActor = {
      owner: audit
        ? { kind: "audit", id: audit.id }
        : { kind: "project", id: project.id },
      workspaceId,
      userId,
      organizationId: null,
    };
    const page = await addProjectSeoPage(actor, {
      url: SEO_TEST_PAGE,
      relationship: "primary",
    });
    const analysis = requestSeoAnalysisSchema.parse({
      kind: paid ? "rankings" : "page_check",
      pageIds: [page.id],
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
      ...(paid ? { keywords: ["widget"], maxProviderCalls: 20 } : {}),
      idempotencyKey: randomUUID(),
    });
    if (paid) {
      const amount = 500n * 10n ** 10n;
      const topUp = await prisma.transaction.create({
        data: { amount, userId },
      });
      await prisma.creditBucket.create({
        data: { amount, userId, sourceTransactionId: topUp.id },
      });
    }
    const monitor = await createProjectSeoMonitor(vars, actor, {
      operationId: randomUUID(),
      rule: {
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "AFTER",
        targetRunCount: 2,
      },
      analysis,
    });
    const runs = await prisma.taskScheduleRun.findMany({
      where: { scheduleId: monitor.id, state: "PLANNED" },
      orderBy: { effectiveScheduledAt: "asc" },
    });
    expect(runs).toHaveLength(2);
    if (paid) await prisma.creditBucket.deleteMany({ where: { userId } });
    const cutoffAt = runs[1].effectiveScheduledAt;
    await prisma.project.update({
      where: { id: project.id },
      data: { closingAt: cutoffAt },
    });
    await prisma.projectCloseOperation.create({
      data: {
        id: randomUUID(),
        projectId: project.id,
        cutoffAt,
        actorUserId: userId,
      },
    });
    const schedule = await prisma.taskSchedule.findUniqueOrThrow({
      where: { id: monitor.id },
    });
    return { project, actor, analysis, schedule, runs, cutoffAt };
  }

  it.each(["project", "audit"] as const)(
    "releases only the owed %s monitor, closes the plan, and imports its later report",
    async (kind) => {
      const f = await fixture(kind);
      await expect(
        requestProjectSeoAnalysis(f.actor, f.analysis),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        prisma.$transaction((tx) =>
          releaseSeoMonitorRun(tx, f.schedule, randomUUID(), true),
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        prisma.$transaction((tx) =>
          releaseSeoMonitorRun(tx, f.schedule, f.runs[1].id),
        ),
      ).rejects.toMatchObject({ status: 409 });
      const result = await prisma.$transaction((tx) =>
        closeTaskScheduleForProject(tx, f.schedule.id, {
          cutoffAt: f.cutoffAt,
          limit: 10,
        }),
      );
      expect(result.ended).toBe(true);
      expect(result.tasks).toHaveLength(1);
      const taskId = result.tasks[0].id;
      expect(
        await prisma.taskScheduleRun.findUnique({
          where: { id: f.runs[0].id },
        }),
      ).toMatchObject({ state: "RELEASED", releasedTaskId: taskId });
      expect(
        await prisma.taskScheduleRun.findUnique({
          where: { id: f.runs[1].id },
        }),
      ).toBeNull();
      expect(
        await prisma.taskSchedule.findUnique({ where: { id: f.schedule.id } }),
      ).toMatchObject({ state: "ENDED", releasedCount: 1 });
      await prisma.project.update({
        where: { id: f.project.id },
        data: { closedAt: new Date() },
      });
      // Closure must not revoke work already released from the approved Run ledger.
      await prisma.$transaction(async (tx) => {
        const task = await requireTaskWorkerContext(
          { actor: "coworker", coworkerId, vendorId },
          taskId,
          { ownerId: userId, organizationId: null, workspaceId },
          tx,
        );
        await requireSeoTaskStartBalance(tx, task);
      });
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "COMPLETED" },
      });
      const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
        where: { taskId },
      });
      const body = JSON.stringify({
        ...focusedReport(),
        requestId: analysis.id,
      });
      const file = await prisma.taskFile.create({
        data: {
          taskId,
          name: `seo-report-${taskId}.json`,
          fileUrl: `https://seo-test.public.blob.vercel-storage.com/tasks/${taskId}/report.json`,
          mimeType: "application/json",
          size: BigInt(Buffer.byteLength(body)),
          uploadedByCoworkerId: coworkerId,
        },
      });
      const fetchArtifact = vi.fn(async () => new Response(body));
      vi.stubGlobal("fetch", fetchArtifact);
      try {
        await reconcileProjectSeoTaskFile(taskId, file.id);
        expect(
          await prisma.projectSeoAnalysis.findUnique({
            where: { id: analysis.id },
          }),
        ).toMatchObject({ status: "completed", failureReason: null });
        expect(
          await prisma.projectSeoObservation.findMany({
            where: { sourceTaskId: taskId },
          }),
        ).toHaveLength(1);
        await importProjectSeoAudit(f.actor, { taskId, fileId: file.id });
        expect(fetchArtifact).toHaveBeenCalledTimes(1);
        await expect(
          importProjectSeoAudit(
            { ...f.actor, owner: { kind: "audit", id: randomUUID() } },
            { taskId, fileId: file.id },
          ),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("keeps an owed Run planned while the same Audit has an active check", async () => {
    const f = await fixture("audit");
    await prisma.project.update({
      where: { id: f.project.id },
      data: { closingAt: null },
    });
    const active = await requestProjectSeoAnalysis(f.actor, f.analysis);
    await prisma.project.update({
      where: { id: f.project.id },
      data: { closingAt: f.cutoffAt },
    });
    await expect(
      prisma.$transaction((tx) =>
        closeTaskScheduleForProject(tx, f.schedule.id, {
          cutoffAt: f.cutoffAt,
          limit: 10,
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("active check"),
    });
    expect(
      await prisma.taskScheduleRun.findUnique({ where: { id: f.runs[0].id } }),
    ).toMatchObject({ state: "PLANNED", releasedTaskId: null });
    await prisma.task.update({
      where: { id: active.taskId! },
      data: { status: "COMPLETED" },
    });
    const result = await prisma.$transaction((tx) =>
      closeTaskScheduleForProject(tx, f.schedule.id, {
        cutoffAt: f.cutoffAt,
        limit: 10,
      }),
    );
    expect(result.tasks).toHaveLength(1);
  });

  it("keeps an owed paid Run planned when its credits were spent before Project close", async () => {
    const f = await fixture("audit", true);
    await expect(
      prisma.$transaction((tx) =>
        closeTaskScheduleForProject(tx, f.schedule.id, {
          cutoffAt: f.cutoffAt,
          limit: 10,
        }),
      ),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("Not enough credits"),
    });
    expect(
      await prisma.taskScheduleRun.findUnique({ where: { id: f.runs[0].id } }),
    ).toMatchObject({ state: "PLANNED", releasedTaskId: null });
    expect(
      await prisma.projectSeoAnalysis.count({
        where: { auditId: f.actor.owner.id },
      }),
    ).toBe(0);
  });

  it.each(["CLOSE_FAILED", "CLOSED"] as const)(
    "rejects an owed Run when the close operation is %s",
    async (state) => {
      const f = await fixture("project");
      await prisma.projectCloseOperation.update({
        where: { projectId: f.project.id },
        data: { state },
      });
      await expect(
        prisma.$transaction((tx) =>
          releaseSeoMonitorRun(tx, f.schedule, f.runs[0].id),
        ),
      ).rejects.toMatchObject({ status: 409 });
    },
  );

  it("rejects ad-hoc report import after Project close", async () => {
    const f = await fixture("project");
    const task = await prisma.task.create({
      data: {
        workspaceId,
        projectId: f.project.id,
        ownerId: userId,
        name: "Legacy SEO report",
        status: "COMPLETED",
        assigneeId: coworkerId,
        visibility: "PUBLIC",
      },
    });
    const body = JSON.stringify(focusedReport());
    const file = await prisma.taskFile.create({
      data: {
        taskId: task.id,
        name: `seo-report-${task.id}.json`,
        fileUrl: `https://seo-test.public.blob.vercel-storage.com/tasks/${task.id}/report.json`,
        mimeType: "application/json",
        size: BigInt(Buffer.byteLength(body)),
        uploadedByCoworkerId: coworkerId,
      },
    });
    const fetchArtifact = vi.fn(async () => new Response(body));
    await expect(
      importProjectSeoAudit(
        f.actor,
        { taskId: task.id, fileId: file.id },
        { fetchImpl: fetchArtifact },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetchArtifact).not.toHaveBeenCalled();
  });
});
