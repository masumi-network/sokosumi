import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { parseSeoMonitorPlan } from "@/lib/seo/monitor-plan";
import { registerTaskFileFromUploadCompleted } from "@/lib/task-file-upload-completed";
import {
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import { testNetworkScope } from "@/test-fixtures/network-scope";
import { focusedReport, SEO_TEST_PAGE } from "@/test-fixtures/project-seo";
import {
  addProjectSeoPage,
  getProjectSeoWorkspace,
} from "./project-seo.service";
import { importProjectSeoAudit } from "./project-seo-import.service";
import {
  createProjectSeoMonitor,
  listProjectSeoMonitors,
  releaseSeoMonitorRun,
} from "./project-seo-monitor.service";
import { requestProjectSeoAnalysis } from "./project-seo-operations.service";

vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  head: async () => ({ size: 1 }),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID();
const workspaceId = randomUUID();
const auditId = randomUUID();
const otherAuditId = randomUUID();
const vendorId = randomUUID();
const coworkerId = randomUUID();
const now = new Date();
const actor: SeoActor = {
  owner: { kind: "audit", id: auditId },
  workspaceId,
  userId,
  organizationId: null,
};
const otherActor: SeoActor = {
  ...actor,
  owner: { kind: "audit", id: otherAuditId },
};
const previousDispatchEnabled = getEnv().SEO_ANALYSIS_DISPATCH_ENABLED;
const previousExecutor = getEnv().SEO_ANALYSIS_EXECUTOR;

describe.skipIf(!enabled)("Independent Audit background ownership", () => {
  beforeAll(async () => {
    getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = true;
    getEnv().SEO_ANALYSIS_EXECUTOR = {
      coworkerId,
      workspaceId,
      ownerId: userId,
      organizationId: null,
      canUsePaidSearchData: false,
      canSchedule: true,
    };
    await prisma.user.create({
      data: {
        id: userId,
        name: "SEO Audit background owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        workspace: { create: { id: workspaceId } },
      },
    });
    for (const id of [auditId, otherAuditId])
      await prisma.seoAudit.create({
        data: {
          id,
          workspaceId,
          createdById: userId,
          name: "Saved page audit",
        },
      });
    await prisma.vendor.create({
      data: { id: vendorId, name: "SEO Audit vendor", slug: vendorId },
    });
    await prisma.coworker.create({
      data: {
        id: coworkerId,
        slug: coworkerId,
        name: "SEO Audit Coworker",
        vendorId,
        capabilities: ["tasks"],
        isWhitelisted: true,
      },
    });
  });

  afterAll(async () => {
    getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = previousDispatchEnabled;
    getEnv().SEO_ANALYSIS_EXECUTOR = previousExecutor;
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.coworker.deleteMany({ where: { id: coworkerId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.$disconnect();
  });

  function analysisInput(pageId: string, idempotencyKey: string) {
    return requestSeoAnalysisSchema.parse({
      kind: "page_check",
      pageIds: [pageId],
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
      coworkerId,
      idempotencyKey,
    });
  }

  it("reconciles a report into its original Audit without a Project or cross-Audit import", async () => {
    const page = await addProjectSeoPage(actor, {
      url: SEO_TEST_PAGE,
      relationship: "primary",
    });
    await addProjectSeoPage(otherActor, {
      url: SEO_TEST_PAGE,
      relationship: "primary",
    });
    const analysis = await requestProjectSeoAnalysis(
      actor,
      analysisInput(page.id, "audit-background-import"),
    );
    expect(analysis.auditId).toBe(auditId);
    expect(analysis.projectId).toBeNull();
    if (!analysis.taskId) throw new Error("The check did not create a Task");
    const task = await prisma.task.update({
      where: { id: analysis.taskId },
      data: { status: "COMPLETED" },
    });
    expect(task.projectId).toBeNull();
    const body = JSON.stringify({ ...focusedReport(), requestId: analysis.id });
    const upload = (extension: string, contentType: string) => {
      const name = `seo-report-${task.id}.${extension}`;
      const pathname = `tasks/${task.id}/${name}`;
      const url = `https://seo-test.public.blob.vercel-storage.com/${pathname}`;
      return registerTaskFileFromUploadCompleted({
        blob: {
          url,
          pathname,
          contentType,
          contentDisposition: "attachment",
          downloadUrl: url,
          etag: '"test"',
        },
        blobToken: "test",
        contextBound: true,
        tokenPayload: JSON.stringify({
          taskId: task.id,
          name,
          size: Buffer.byteLength(body),
          mimeType: contentType,
          uploadedByUserId: null,
          uploadedByCoworkerId: coworkerId,
          contextBinding: {
            contextVersion: 1,
            coworkerId,
            vendorId,
            expectedContext: {
              ownerId: userId,
              workspaceId,
              organizationId: null,
            },
          },
        }),
      });
    };
    const fetchArtifact = vi.fn(async () => new Response(body));
    vi.stubGlobal("fetch", fetchArtifact);
    try {
      await upload("pdf", "application/pdf");
      await upload("pdf", "application/pdf");
      expect(
        await prisma.taskFile.findMany({
          where: { taskId: task.id },
          select: { name: true, mimeType: true, uploadedByCoworkerId: true },
        }),
      ).toEqual([
        {
          name: `seo-report-${task.id}.pdf`,
          mimeType: "application/pdf",
          uploadedByCoworkerId: coworkerId,
        },
      ]);
      expect
        .soft(
          (
            await prisma.projectSeoAnalysis.findUniqueOrThrow({
              where: { id: analysis.id },
            })
          ).status,
        )
        .toBe(analysis.status);
      expect(fetchArtifact).not.toHaveBeenCalled();
      await upload("data.json", "application/json");
      expect.soft(fetchArtifact).toHaveBeenCalledTimes(1);
      await upload("data.json", "application/json");
      const file = await prisma.taskFile.findFirstOrThrow({
        where: { taskId: task.id, mimeType: "application/json" },
      });
      expect(fetchArtifact).toHaveBeenCalledTimes(1);
      await expect(
        importProjectSeoAudit(otherActor, { taskId: task.id, fileId: file.id }),
      ).rejects.toMatchObject({ status: 404 });
      const workspace = await getProjectSeoWorkspace(actor);
      expect(
        workspace.analyses.find((row) => row.id === analysis.id)?.status,
      ).toBe("completed");
      expect(workspace.observations).toHaveLength(1);
      expect(
        (await getProjectSeoWorkspace(otherActor)).observations,
      ).toHaveLength(0);
      expect(await prisma.project.count({ where: { workspaceId } })).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("releases only planned finite Runs in their Audit and lists no sibling Audit monitor", async () => {
    const page = await addProjectSeoPage(actor, {
      url: SEO_TEST_PAGE,
      relationship: "primary",
    });
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
    const monitor = await createProjectSeoMonitor(vars, actor, {
      operationId: randomUUID(),
      rule: {
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "AFTER" as const,
        targetRunCount: 2,
      },
      analysis: analysisInput(page.id, "audit-monitor-template"),
    });
    const schedule = await prisma.taskSchedule.findUniqueOrThrow({
      where: { id: monitor.id },
    });
    expect(schedule.projectId).toBeNull();
    expect(parseSeoMonitorPlan(schedule.description)).toMatchObject({
      version: 2,
      auditId,
    });
    const runs = await prisma.taskScheduleRun.findMany({
      where: { scheduleId: monitor.id, state: "PLANNED" },
      orderBy: { effectiveScheduledAt: "asc" },
    });
    expect(runs).toHaveLength(2);
    const first = await prisma.$transaction((tx) =>
      releaseSeoMonitorRun(tx, schedule, runs[0].id),
    );
    const replay = await prisma.$transaction((tx) =>
      releaseSeoMonitorRun(tx, schedule, runs[0].id),
    );
    expect(replay?.id).toBe(first?.id);
    const released = await prisma.projectSeoAnalysis.findFirstOrThrow({
      where: { taskId: first?.id ?? "missing" },
    });
    expect(released).toMatchObject({
      auditId,
      projectId: null,
      pageIds: [page.id],
    });
    expect((await listProjectSeoMonitors(actor)).map((row) => row.id)).toEqual([
      monitor.id,
    ]);
    expect(await listProjectSeoMonitors(otherActor)).toEqual([]);
    await expect(
      prisma.$transaction((tx) =>
        releaseSeoMonitorRun(tx, schedule, randomUUID()),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      prisma.$transaction((tx) =>
        releaseSeoMonitorRun(
          tx,
          { ...schedule, workspaceId: randomUUID() },
          runs[1].id,
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
