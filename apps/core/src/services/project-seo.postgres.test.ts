import { randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getEnv } from "@/config/env";

import { forbidden } from "@/helpers/error";
import { parsePublicSeoArtifact } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import seo from "@/routes/v1/projects/[id]/seo";
import {
  type NativeSeoMetrics,
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import {
  focusedReport,
  legacyReport,
  SEO_TEST_PAGE,
} from "@/test-fixtures/project-seo";
import {
  addProjectSeoPage,
  createProjectSeoScope,
  getProjectSeoWorkspace,
  recordNativeSeoMetrics,
  updateProjectSeoScope,
} from "./project-seo.service";

import {
  importProjectSeoAudit,
  reconcileProjectSeoTaskFile,
} from "./project-seo-import.service";
import {
  createProjectSeoMonitor,
  releaseSeoMonitorRun,
} from "./project-seo-monitor.service";
import {
  createProjectSeoActionTask,
  requestProjectSeoAnalysis,
} from "./project-seo-operations.service";
import {
  changeTaskScheduleState,
  updateTaskSchedule,
} from "./task-schedule.service";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID(),
  otherId = randomUUID(),
  workspaceId = randomUUID(),
  otherWorkspaceId = randomUUID(),
  projectId = randomUUID(),
  vendorId = randomUUID(),
  coworkerId = randomUUID();
const actor: SeoActor = {
  projectId,
  workspaceId,
  userId,
  organizationId: null,
};
const now = new Date();
const previousDispatchEnabled = getEnv().SEO_ANALYSIS_DISPATCH_ENABLED;

describe.skipIf(!enabled)(
  "SEO workspace with the repository PostgreSQL schema",
  () => {
    beforeAll(async () => {
      // These isolated fixtures exercise the already-verified versioned worker contract.
      getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = true;
      for (const [id, ws] of [
        [userId, workspaceId],
        [otherId, otherWorkspaceId],
      ])
        await prisma.user.create({
          data: {
            id,
            name: "SEO test owner",
            email: `${id}@example.test`,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
            workspace: { create: { id: ws } },
          },
        });
      await prisma.project.create({
        data: { id: projectId, workspaceId, name: "SEO test project" },
      });
      await prisma.vendor.create({
        data: { id: vendorId, name: "SEO test vendor", slug: vendorId },
      });
      await prisma.coworker.create({
        data: {
          id: coworkerId,
          slug: coworkerId,
          name: "SEO test Coworker",
          vendorId,
          capabilities: ["tasks"],
          isWhitelisted: true,
        },
      });
    });
    afterAll(async () => {
      getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = previousDispatchEnabled;
      await prisma.task.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspaceId, otherWorkspaceId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [userId, otherId] } },
      });
      await prisma.coworker.deleteMany({ where: { id: coworkerId } });
      await prisma.vendor.deleteMany({ where: { id: vendorId } });
      await prisma.$disconnect();
    });

    it("creates no analysis Task or monitor while the worker rollout is disabled", async () => {
      const previous = getEnv().SEO_ANALYSIS_DISPATCH_ENABLED;
      getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = false;
      try {
        const page = await addProjectSeoPage(actor, {
          url: "https://example.test/dispatch-preview",
          relationship: "primary",
        });
        const analysis = requestSeoAnalysisSchema.parse({
          kind: "page_check",
          pageIds: [page.id],
          countryCode: "DE",
          languageCode: "de",
          devices: ["mobile"],
          maxProviderCalls: 0,
          coworkerId,
          idempotencyKey: "disabled-dispatch-test",
        });
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
        const beforeTasks = await prisma.task.count({ where: { workspaceId } });
        const beforeAnalyses = await prisma.projectSeoAnalysis.count({
          where: { projectId },
        });
        const beforeSchedules = await prisma.taskSchedule.count({
          where: { workspaceId },
        });
        await expect(
          requestProjectSeoAnalysis(actor, analysis),
        ).rejects.toMatchObject({
          status: 409,
          message: expect.stringContaining("dispatch is disabled"),
        });
        await expect(
          createProjectSeoMonitor(vars, actor, {
            operationId: randomUUID(),
            cadence: "daily",
            timeZone: "UTC",
            targetRunCount: 2,
            analysis,
          }),
        ).rejects.toMatchObject({
          status: 409,
          message: expect.stringContaining("dispatch is disabled"),
        });
        expect(await prisma.task.count({ where: { workspaceId } })).toBe(
          beforeTasks,
        );
        expect(
          await prisma.projectSeoAnalysis.count({ where: { projectId } }),
        ).toBe(beforeAnalyses);
        expect(
          await prisma.taskSchedule.count({ where: { workspaceId } }),
        ).toBe(beforeSchedules);
        await recordNativeSeoMetrics(actor, metrics([page.url]));
        const workspace = await getProjectSeoWorkspace(actor, {
          pageId: page.id,
        });
        expect(workspace.availableActions).toMatchObject({
          canEdit: true,
          canRequestAnalysis: false,
          canSyncMetrics: true,
        });
        expect(workspace.metrics).toHaveLength(1);
      } finally {
        getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = previous;
      }
    });

    it("retains workspace context through nested statistics routes without a bot", async () => {
      const app = new OpenAPIHonoWithAuth();
      app.use("*", async (c, next) => {
        c.set("requestId", "seo-route-test");
        c.set("isAuthenticated", true);
        c.set("authContext", {
          actor: "user",
          userId,
          organizationId: null,
          role: "user",
        });
        c.set("workspaceContext", {
          workspaceId,
          userId,
          organizationId: null,
        });
        await next();
      });
      app.onError((error, c) =>
        c.json(
          { error: error.message },
          error instanceof HTTPException ? error.status : 500,
        ),
      );
      app.route("/projects/:id/seo", seo);
      const response = await app.request(
        `http://localhost/projects/${projectId}/seo/statistics/properties?provider=ga4`,
      );
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.data).toMatchObject({
        provider: "ga4",
        status: "not_connected",
        properties: [],
      });
      const first = await addProjectSeoPage(actor, {
        url: "https://example.test/query-one",
        relationship: "primary",
      });
      const second = await addProjectSeoPage(actor, {
        url: "https://example.test/query-two",
        relationship: "primary",
      });
      const selected = await app.request(
        `http://localhost/projects/${projectId}/seo?pageIds=${first.id}&pageIds=${second.id}`,
      );
      const selectedText = await selected.text();
      expect(selected.status, selectedText).toBe(200);
      const selectedBody = JSON.parse(selectedText);
      expect(selectedBody.data.scope.pageIds).toEqual(
        expect.arrayContaining([first.id, second.id]),
      );
      expect(selectedBody.data.scope.pageIds).toHaveLength(2);
    });

    it("scopes pages, freezes group versions and fences cancelled writes", async () => {
      const first = await addProjectSeoPage(actor, {
        url: SEO_TEST_PAGE,
        relationship: "primary",
      });
      const second = await addProjectSeoPage(actor, {
        url: "https://example.test/related",
        relationship: "related",
        relatedToPageId: first.id,
      });
      await expect(
        addProjectSeoPage(
          { ...actor, workspaceId: otherWorkspaceId },
          { url: "https://example.test/no", relationship: "primary" },
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        addProjectSeoPage(
          actor,
          { url: "https://example.test/cancelled", relationship: "primary" },
          {
            authorize: async () => {
              throw forbidden("Turn cancelled");
            },
          },
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await prisma.projectSeoPage.count({
          where: { projectId, url: "https://example.test/cancelled" },
        }),
      ).toBe(0);
      const scope = await createProjectSeoScope(actor, {
        name: "Related pages",
        pageIds: [first.id],
      });
      const input = requestSeoAnalysisSchema.parse({
        kind: "page_check",
        scopeId: scope.id,
        expectedScopeVersion: 1,
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop"],
        idempotencyKey: "frozen-analysis-test",
        coworkerId,
      });
      const analysis = await requestProjectSeoAnalysis(actor, input);
      expect((await requestProjectSeoAnalysis(actor, input)).id).toBe(
        analysis.id,
      );
      expect(
        await prisma.task.count({
          where: { id: analysis.taskId ?? "missing" },
        }),
      ).toBe(1);
      await updateProjectSeoScope(actor, scope.id, {
        name: "Changed group",
        pageIds: [second.id],
        expectedVersion: 1,
      });
      const frozen = await prisma.projectSeoAnalysis.findUniqueOrThrow({
        where: { id: analysis.id },
      });
      expect(frozen.pageIds).toEqual([first.id]);
      expect(frozen.scopeVersion).toBe(1);
      await expect(
        requestProjectSeoAnalysis(actor, {
          ...input,
          idempotencyKey: "stale-analysis-test",
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        recordNativeSeoMetrics(actor, metrics([first.url]), {
          scope: { id: scope.id, version: 1, pageIds: [first.id] },
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("keeps stored native metrics owner-only and removes access for archived or shared bots", async () => {
      const page = await addProjectSeoPage(actor, {
        url: SEO_TEST_PAGE,
        relationship: "primary",
      });
      await recordNativeSeoMetrics(actor, metrics([page.url]));
      const bot = await prisma.sokoBot.create({
        data: { userId, workspaceId, name: "Personal SEO test" },
      });
      const botActor = {
        ...actor,
        sokoBotId: bot.id,
        privateMetricsAllowed: true,
      };
      expect(
        (await getProjectSeoWorkspace(botActor, { pageId: page.id })).metrics,
      ).toHaveLength(1);
      expect(
        (
          await getProjectSeoWorkspace(
            { ...botActor, privateMetricsAllowed: false },
            { pageId: page.id },
          )
        ).metrics,
      ).toHaveLength(0);
      await prisma.sokoBot.update({
        where: { id: bot.id },
        data: { archivedAt: now },
      });
      expect(
        (await getProjectSeoWorkspace(botActor, { pageId: page.id })).metrics,
      ).toHaveLength(0);
      const shared = await prisma.sokoBot.create({
        data: { projectId, workspaceId, name: "Shared SEO test" },
      });
      expect(
        (
          await getProjectSeoWorkspace(
            { ...botActor, sokoBotId: shared.id },
            { pageId: page.id },
          )
        ).metrics,
      ).toHaveLength(0);
      await expect(
        getProjectSeoWorkspace({ ...actor, userId: otherId }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("releases distinct frozen finite monitor Runs and refuses an unapproved assignee or manual extra Run", async () => {
      const page = await addProjectSeoPage(actor, {
        url: SEO_TEST_PAGE,
        relationship: "primary",
      });
      const analysis = requestSeoAnalysisSchema.parse({
        kind: "page_check",
        pageIds: [page.id],
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop"],
        coworkerId,
        idempotencyKey: "monitor-analysis",
      });
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
      const input = {
        operationId: randomUUID(),
        cadence: "daily" as const,
        targetRunCount: 2,
        timeZone: "UTC",
        analysis,
      };
      const monitor = await createProjectSeoMonitor(vars, actor, input);
      expect((await createProjectSeoMonitor(vars, actor, input)).id).toBe(
        monitor.id,
      );
      await expect(
        updateTaskSchedule(vars, monitor.id, {
          expectedRevision: monitor.revision,
          description: "Widen the monitor",
        }),
      ).rejects.toMatchObject({ status: 409 });
      const runs = await prisma.taskScheduleRun.findMany({
        where: { scheduleId: monitor.id, state: "PLANNED" },
        orderBy: { effectiveScheduledAt: "asc" },
      });
      expect(runs).toHaveLength(2);
      const schedule = await prisma.taskSchedule.findUniqueOrThrow({
        where: { id: monitor.id },
      });
      const first = await prisma.$transaction((tx) =>
        releaseSeoMonitorRun(tx, schedule, runs[0].id),
      );
      const same = await prisma.$transaction((tx) =>
        releaseSeoMonitorRun(tx, schedule, runs[0].id),
      );
      const second = await prisma.$transaction((tx) =>
        releaseSeoMonitorRun(tx, schedule, runs[1].id),
      );
      expect(same?.id).toBe(first?.id);
      expect(second?.id).not.toBe(first?.id);
      const analyses = await prisma.projectSeoAnalysis.findMany({
        where: {
          taskId: { in: [first?.id ?? "missing", second?.id ?? "missing"] },
        },
      });
      expect(analyses).toHaveLength(2);
      expect(
        analyses.every(
          (row) => row.pageIds.length === 1 && row.pageIds[0] === page.id,
        ),
      ).toBe(true);
      await expect(
        prisma.$transaction((tx) =>
          releaseSeoMonitorRun(tx, schedule, randomUUID()),
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        prisma.$transaction((tx) =>
          releaseSeoMonitorRun(
            tx,
            { ...schedule, assigneeId: "replaced" },
            runs[0].id,
          ),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (await changeTaskScheduleState(vars, monitor.id, "pause")).state,
      ).toBe("PAUSED");
    });

    it("auto-imports the exact completed Analysis artifact once without reading a URL on workspace views", async () => {
      const page = await addProjectSeoPage(actor, {
        url: SEO_TEST_PAGE,
        relationship: "primary",
      });
      const analysis = await requestProjectSeoAnalysis(
        actor,
        requestSeoAnalysisSchema.parse({
          kind: "page_check",
          pageIds: [page.id],
          countryCode: "US",
          languageCode: "en",
          devices: ["desktop"],
          idempotencyKey: "auto-import-analysis-test",
          coworkerId,
        }),
      );
      if (!analysis.taskId)
        throw new Error("The Analysis did not create a Task");
      await prisma.task.update({
        where: { id: analysis.taskId },
        data: { status: "COMPLETED" },
      });
      const body = JSON.stringify({
        ...focusedReport(),
        requestId: analysis.id,
      });
      const file = await prisma.taskFile.create({
        data: {
          taskId: analysis.taskId,
          name: `seo-report-${analysis.taskId}.json`,
          fileUrl: `https://seo-test.public.blob.vercel-storage.com/tasks/${analysis.taskId}/report.json`,
          mimeType: "application/json",
          size: BigInt(Buffer.byteLength(body)),
          uploadedByCoworkerId: coworkerId,
        },
      });
      let reads = 0;
      vi.stubGlobal("fetch", async () => {
        reads++;
        return new Response(body);
      });
      try {
        await reconcileProjectSeoTaskFile(analysis.taskId, file.id);
        await reconcileProjectSeoTaskFile(analysis.taskId, file.id);
        const workspace = await getProjectSeoWorkspace(actor, {
          pageId: page.id,
        });
        expect(
          workspace.analyses.find((row) => row.id === analysis.id)?.status,
        ).toBe("completed");
        expect(
          workspace.observations.filter(
            (row) => row.sourceTaskId === analysis.taskId,
          ),
        ).toHaveLength(1);
        expect(reads).toBe(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("applies the selected page filter before the bounded history limit", async () => {
      const selected = await addProjectSeoPage(actor, {
        url: "https://example.test/history-target",
        relationship: "primary",
      });
      const other = await addProjectSeoPage(actor, {
        url: "https://example.test/history-noise",
        relationship: "primary",
      });
      const payload = parsePublicSeoArtifact({
        ...legacyReport(),
        request: { url: selected.url },
      });
      const selectedObservation = await prisma.projectSeoObservation.create({
        data: {
          projectId,
          source: "seo_coworker",
          kind: "audit_full",
          sourceKey: randomUUID(),
          pageIds: [selected.id],
          artifactHash: "history-target",
          payload,
          observedAt: new Date("2026-10-01T00:00:00Z"),
        },
      });
      await prisma.projectSeoObservation.createMany({
        data: Array.from({ length: 101 }, (_, index) => ({
          projectId,
          source: "seo_coworker",
          kind: "audit_full",
          sourceKey: `history-noise:${index}`,
          pageIds: [other.id],
          artifactHash: "history-noise",
          payload,
          observedAt: new Date("2026-11-01T00:00:00Z"),
        })),
      });
      expect(
        (
          await getProjectSeoWorkspace(actor, { pageId: selected.id })
        ).observations.map((row) => row.id),
      ).toContain(selectedObservation.id);
    });

    it("imports only ready owned artifacts, rechecks source authority after fetch and links each action once", async () => {
      async function source() {
        const task = await prisma.task.create({
          data: {
            name: "Public completed audit",
            ownerId: userId,
            workspaceId,
            status: "COMPLETED",
            assigneeId: coworkerId,
          },
        });
        const body = JSON.stringify(legacyReport());
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
        return { taskId: task.id, fileId: file.id, body };
      }
      const allowed = await source();
      let reads = 0;
      const fetchImpl: typeof fetch = async () => {
        reads++;
        return new Response(allowed.body);
      };
      const imported = await importProjectSeoAudit(actor, allowed, {
        fetchImpl,
      });
      expect(
        (await importProjectSeoAudit(actor, allowed, { fetchImpl })).id,
      ).toBe(imported.id);
      expect(reads).toBe(1);
      const action = {
        observationId: imported.id,
        actionId: "1",
        idempotencyKey: "seo-action-link-test",
      };
      const link = await createProjectSeoActionTask(actor, action);
      expect((await createProjectSeoActionTask(actor, action)).taskId).toBe(
        link.taskId,
      );
      expect(
        await prisma.task.findUniqueOrThrow({ where: { id: link.taskId } }),
      ).toMatchObject({ status: "DRAFT", projectId, ownerId: userId });
      const changed = await source();
      await expect(
        importProjectSeoAudit(actor, changed, {
          fetchImpl: async () => {
            await prisma.task.update({
              where: { id: changed.taskId },
              data: { visibility: "PRIVATE" },
            });
            return new Response(changed.body);
          },
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await prisma.projectSeoObservation.count({
          where: { sourceTaskId: changed.taskId },
        }),
      ).toBe(0);
      const remote = await source();
      await prisma.taskFile.update({
        where: { id: remote.fileId },
        data: {
          fileUrl: `http://127.0.0.1/tasks/${remote.taskId}/report.json`,
        },
      });
      await expect(
        importProjectSeoAudit(actor, remote, {
          fetchImpl: async () => {
            throw new Error("Network must not run");
          },
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
  },
);

function metrics(pageUrls: string[]): NativeSeoMetrics {
  return {
    provider: "ga4",
    propertyId: "properties/123",
    channel: "all",
    pageUrls,
    from: "2026-10-01",
    to: "2026-10-31",
    timeZone: "UTC",
    observedAt: "2026-11-01T12:00:00.000Z",
    coverage: "complete",
    notes: [],
    metrics: [
      {
        key: "page_views",
        label: "Page views",
        unit: "count",
        value: 12,
        points: [],
      },
    ],
  };
}
