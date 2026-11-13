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
  notifySeoMonitorWorse,
  SEO_MONITOR_WORSE_MESSAGE_KEY,
} from "./project-seo-monitor-notify";
import {
  createProjectSeoActionTask,
  requestProjectSeoAnalysis,
} from "./project-seo-operations.service";
import {
  changeTaskScheduleState,
  runTaskScheduleNow,
  updateTaskSchedule,
} from "./task-schedule.service";

// Notification and Task events publish after the test that made them: keep them off the network of later tests.
vi.mock("@/helpers/notification-publish-queue", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/helpers/notification-publish-queue")
  >()),
  scheduleNotificationPublish: vi.fn(),
}));
vi.mock("@/helpers/notification-email-dispatch", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/helpers/notification-email-dispatch")
  >()),
  dispatchNotificationEmail: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ably/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ably/publish")>()),
  publishTaskEventData: vi.fn(async () => undefined),
}));
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
  owner: { kind: "project", id: projectId },
  workspaceId,
  userId,
  organizationId: null,
};
const now = new Date();
const previousDispatchEnabled = getEnv().SEO_ANALYSIS_DISPATCH_ENABLED;
const previousExecutor = getEnv().SEO_ANALYSIS_EXECUTOR;

describe.skipIf(!enabled)(
  "SEO workspace with the repository PostgreSQL schema",
  () => {
    beforeAll(async () => {
      // These isolated fixtures exercise the already-verified versioned worker contract.
      getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = true;
      getEnv().SEO_ANALYSIS_EXECUTOR = {
        coworkerId,
        workspaceId,
        ownerId: userId,
        organizationId: null,
        canUsePaidSearchData: true,
        canSchedule: true,
      };
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
      getEnv().SEO_ANALYSIS_EXECUTOR = previousExecutor;
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
            rule: {
              expr: "0 9 * * *",
              timezone: "UTC",
              endsMode: "AFTER" as const,
              targetRunCount: 2,
            },
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

    it("turns a Search Console opportunity into one Task across syncs and hides it from other users", async () => {
      const page = await addProjectSeoPage(actor, {
        url: SEO_TEST_PAGE,
        relationship: "primary",
      });
      const searchMetrics = (observedAt: string): NativeSeoMetrics => ({
        ...metrics([page.url]),
        provider: "search_console",
        propertyId: "sc-domain:example.test",
        channel: "organic",
        observedAt,
        queries: {
          rowLimit: 250,
          truncated: false,
          rows: [
            {
              query: "battery health",
              pageUrl: page.url,
              clicks: 0,
              impressions: 12,
              ctr: 0,
              averagePosition: 3.2,
            },
          ],
        },
      });
      await recordNativeSeoMetrics(
        actor,
        searchMetrics("2026-11-01T12:00:00.000Z"),
      );
      const first = await getProjectSeoWorkspace(actor, { pageId: page.id });
      const opportunity = first.actions.find(
        (row) => row.kind === "opportunity",
      );
      expect(first.searchQueries?.rows).toHaveLength(1);
      expect(opportunity).toBeDefined();
      if (!opportunity) return;
      await expect(
        createProjectSeoActionTask(
          { ...actor, userId: otherId },
          {
            observationId: opportunity.observationId,
            actionId: opportunity.id,
            idempotencyKey: "seo-opportunity-other",
          },
        ),
      ).rejects.toMatchObject({ status: 404 });
      const link = await createProjectSeoActionTask(actor, {
        observationId: opportunity.observationId,
        actionId: opportunity.id,
        idempotencyKey: "seo-opportunity-first",
      });
      const task = await prisma.task.findUniqueOrThrow({
        where: { id: link.taskId },
      });
      expect(task).toMatchObject({ status: "DRAFT", ownerId: userId });
      expect(task.description).toContain("Measured evidence");
      // An existing link is not a way around the private metrics read check.
      await expect(
        createProjectSeoActionTask(
          { ...actor, sokoBotId: randomUUID(), privateMetricsAllowed: false },
          {
            observationId: opportunity.observationId,
            actionId: opportunity.id,
            idempotencyKey: "seo-opportunity-bot",
          },
        ),
      ).rejects.toMatchObject({ status: 404 });
      await recordNativeSeoMetrics(
        actor,
        searchMetrics("2026-11-02T12:00:00.000Z"),
      );
      const second = await getProjectSeoWorkspace(actor, { pageId: page.id });
      const repeated = second.actions.filter(
        (row) => row.id === opportunity.id,
      );
      expect(repeated).toEqual([
        expect.objectContaining({
          taskId: link.taskId,
          status: "task_created",
        }),
      ]);
      const newer = second.searchQueries?.observationId;
      expect(newer).not.toBe(opportunity.observationId);
      if (!newer) return;
      expect(
        (
          await createProjectSeoActionTask(actor, {
            observationId: newer,
            actionId: opportunity.id,
            idempotencyKey: "seo-opportunity-second",
          })
        ).taskId,
      ).toBe(link.taskId);
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
        rule: {
          expr: "0 9 * * *",
          timezone: "UTC",
          endsMode: "AFTER" as const,
          targetRunCount: 2,
        },
        analysis,
      };
      // A packet the worker would refuse fails at creation, not at every Run.
      await expect(
        createProjectSeoMonitor(vars, actor, {
          ...input,
          operationId: randomUUID(),
          analysis: requestSeoAnalysisSchema.parse({
            ...analysis,
            kind: "links",
            idempotencyKey: "monitor-long-links",
            competitorUrls: Array.from(
              { length: 10 },
              (_, n) => `https://competitor-${n}.test/${"a".repeat(4000)}`,
            ),
          }),
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("too long for the worker"),
      });
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

    it("edits only a monitor's rule, runs it now, and tells its Owner only when a result got worse", async () => {
      const page = await addProjectSeoPage(actor, {
        url: "https://example.test/monitor-ux",
        relationship: "primary",
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
      const monitor = await createProjectSeoMonitor(vars, actor, {
        operationId: randomUUID(),
        rule: {
          expr: "0 9 * * *",
          timezone: "UTC",
          endsMode: "AFTER",
          targetRunCount: 3,
        },
        analysis: requestSeoAnalysisSchema.parse({
          kind: "page_check",
          pageIds: [page.id],
          countryCode: "US",
          languageCode: "en",
          devices: ["desktop"],
          coworkerId,
          idempotencyKey: "monitor-ux-analysis",
        }),
      });
      // Another member of the workspace may read the monitor but not add Runs billed to its owner.
      const memberVars = {
        ...vars,
        authContext: { ...vars.authContext, userId: otherId },
        workspaceContext: {
          workspaceId,
          userId: otherId,
          organizationId: null,
        },
      };
      await expect(
        updateTaskSchedule(memberVars, monitor.id, {
          expectedRevision: monitor.revision,
          rule: { expr: "0 9 * * *", timezone: "UTC", endsMode: "NEVER" },
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        runTaskScheduleNow(memberVars, monitor.id, {
          expectedRevision: monitor.revision,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        updateTaskSchedule(vars, monitor.id, {
          expectedRevision: monitor.revision,
          rule: { expr: "*/5 * * * *", timezone: "UTC", endsMode: "NEVER" },
        }),
      ).rejects.toMatchObject({ status: 422 });
      const edited = await updateTaskSchedule(vars, monitor.id, {
        expectedRevision: monitor.revision,
        rule: {
          expr: "30 7 * * *",
          timezone: "Europe/Berlin",
          endsMode: "NEVER",
        },
      });
      const rule = {
        expr: "30 7 * * *",
        timezone: "Europe/Berlin",
        endsMode: "NEVER",
        targetRunCount: null,
      };
      expect(edited).toMatchObject(rule);
      const schedule = await prisma.taskSchedule.findUniqueOrThrow({
        where: { id: monitor.id },
      });
      const planned = await prisma.taskScheduleRun.findFirstOrThrow({
        where: { scheduleId: monitor.id, state: "PLANNED" },
        orderBy: { effectiveScheduledAt: "asc" },
      });
      // The edited rule is the approved rule: its planned Run still releases.
      const scheduled = await prisma.$transaction((tx) =>
        releaseSeoMonitorRun(tx, schedule, planned.id),
      );
      const ranNow = await runTaskScheduleNow(vars, monitor.id, {
        expectedRevision: edited.revision,
      });
      expect(ranNow.run.manual).toBe(true);
      const ranAgain = await runTaskScheduleNow(vars, monitor.id, {
        expectedRevision: ranNow.revision,
      });
      for (const taskId of [
        ranNow.run.releasedTaskId,
        ranAgain.run.releasedTaskId,
      ])
        expect(
          await prisma.projectSeoAnalysis.count({ where: { taskId: taskId! } }),
        ).toBe(1);

      const result = async (taskId: string, at: string, title: string) =>
        prisma.projectSeoObservation.create({
          data: {
            projectId,
            kind: "page_check",
            source: "seo_coworker",
            sourceKey: randomUUID(),
            sourceTaskId: taskId,
            pageIds: [page.id],
            artifactHash: randomUUID(),
            observedAt: new Date(at),
            payload: {
              version: 1,
              kind: "page_check",
              requestId: null,
              pageUrls: [page.url],
              observedAt: at,
              countryCode: "US",
              languageCode: "en",
              rulebookVersion: "r1",
              checks: [
                {
                  rowId: "title",
                  pageUrl: page.url,
                  device: "desktop",
                  result: title,
                },
              ],
              keywords: [],
              competitors: [],
              findings: [],
              actions: [],
              coverage: { checked: 1, skipped: 0, failed: 0 },
              notes: [],
            },
          },
        });
      const worse = () =>
        prisma.notification.count({
          where: { userId, messageKey: SEO_MONITOR_WORSE_MESSAGE_KEY },
        });
      await result(scheduled!.id, "2026-11-01T09:00:00.000Z", "pass");
      const same = await result(
        ranNow.run.releasedTaskId!,
        "2026-11-02T09:00:00.000Z",
        "pass",
      );
      await notifySeoMonitorWorse(ranNow.run.releasedTaskId!, same.id);
      expect(await worse()).toBe(0);
      // The worse result arrives through the import path, as a Coworker upload does. A second read sends no second
      // notification.
      const againTaskId = ranAgain.run.releasedTaskId!;
      const againAnalysis = await prisma.projectSeoAnalysis.findFirstOrThrow({
        where: { taskId: againTaskId },
      });
      await prisma.task.update({
        where: { id: againTaskId },
        data: { status: "COMPLETED" },
      });
      const report = focusedReport();
      const body = JSON.stringify({
        ...report,
        requestId: againAnalysis.id,
        scope: { ...report.scope, pageUrls: [page.url] },
        observedAt: "2026-11-03T09:00:00.000Z",
        // The same rulebook as the results before, so the two Runs compare.
        rulebookVersion: "r1",
        checks: [{ ...report.checks[0], pageUrl: page.url, result: "fired" }],
      });
      const file = await prisma.taskFile.create({
        data: {
          taskId: againTaskId,
          name: `seo-report-${againTaskId}.json`,
          fileUrl: `https://seo-test.public.blob.vercel-storage.com/tasks/${againTaskId}/report.json`,
          mimeType: "application/json",
          size: BigInt(Buffer.byteLength(body)),
          uploadedByCoworkerId: coworkerId,
        },
      });
      vi.stubGlobal("fetch", async () => new Response(body));
      try {
        await reconcileProjectSeoTaskFile(againTaskId, file.id);
        await reconcileProjectSeoTaskFile(againTaskId, file.id);
      } finally {
        vi.unstubAllGlobals();
      }
      expect(await worse()).toBe(1);
      // A second file of the same Run counts once: the change still compares against the Run before.
      await result(againTaskId, "2026-11-03T10:00:00.000Z", "fired");
      // A late result of the oldest Run keeps that Run's place: the pair stays the two newest Runs.
      await result(scheduled!.id, "2026-11-04T09:00:00.000Z", "pass");

      const workspace = await getProjectSeoWorkspace(actor, {
        pageId: page.id,
      });
      const listed = workspace.monitors.find((item) => item.id === monitor.id);
      expect(listed).toMatchObject({
        rule,
        pageIds: [page.id],
        isOwner: true,
        lastRun: { taskId: ranAgain.run.releasedTaskId },
        change: { comparable: true, newFailureCount: 1, fixedCount: 0 },
      });
      expect(
        workspace.runs?.filter((run) => run.monitorId === monitor.id),
      ).toHaveLength(5); // Each stored result is one history entry: three Runs, two of them with two files.
    });

    it("uses configured protocol authority instead of imported-file provenance or the source Task assignee", async () => {
      const sourceCoworkerId = randomUUID();
      const replacementCoworkerId = randomUUID();
      const project = await prisma.project.create({
        data: { workspaceId, name: "Imported executor provenance" },
      });
      const sourceActor: SeoActor = {
        ...actor,
        owner: { kind: "project", id: project.id },
      };
      const unexpectedNetwork = vi.fn(async () => {
        throw new Error(
          "Unexpected external request during executor selection",
        );
      });
      vi.stubGlobal("fetch", unexpectedNetwork);
      try {
        await prisma.coworker.createMany({
          data: [sourceCoworkerId, replacementCoworkerId].map((id) => ({
            id,
            slug: id,
            name: "Task-capable executor fixture",
            vendorId,
            capabilities: ["tasks"],
            isWhitelisted: true,
          })),
        });
        const page = await addProjectSeoPage(sourceActor, {
          url: SEO_TEST_PAGE,
          relationship: "primary",
        });
        const sourceTask = await prisma.task.create({
          data: {
            name: "Completed source report",
            workspaceId,
            projectId: project.id,
            ownerId: userId,
            assigneeId: sourceCoworkerId,
            status: "COMPLETED",
          },
        });
        const report = JSON.stringify(legacyReport());
        const sourceFile = await prisma.taskFile.create({
          data: {
            taskId: sourceTask.id,
            name: `seo-report-${sourceTask.id}.json`,
            fileUrl: `https://seo-test.public.blob.vercel-storage.com/tasks/${sourceTask.id}/report.json`,
            mimeType: "application/json",
            size: BigInt(Buffer.byteLength(report)),
            uploadedByCoworkerId: sourceCoworkerId,
          },
        });
        const observation = await importProjectSeoAudit(
          sourceActor,
          { taskId: sourceTask.id, fileId: sourceFile.id },
          { fetchImpl: async () => new Response(report) },
        );
        await prisma.task.update({
          where: { id: sourceTask.id },
          data: { assigneeId: replacementCoworkerId },
        });
        const request = requestSeoAnalysisSchema.parse({
          kind: "page_check",
          pageIds: [page.id],
          countryCode: "US",
          languageCode: "en",
          devices: ["desktop"],
          maxProviderCalls: 0,
          idempotencyKey: randomUUID(),
        });
        const inferred = await requestProjectSeoAnalysis(sourceActor, request);
        expect(
          await prisma.task.findUniqueOrThrow({
            where: { id: inferred.taskId! },
          }),
        ).toMatchObject({ assigneeId: coworkerId });
        expect(
          (await requestProjectSeoAnalysis(sourceActor, request)).taskId,
        ).toBe(inferred.taskId);

        await expect(
          requestProjectSeoAnalysis(sourceActor, {
            ...request,
            idempotencyKey: randomUUID(),
            coworkerId: replacementCoworkerId,
          }),
        ).rejects.toMatchObject({ status: 409 });

        const analysisCount = await prisma.projectSeoAnalysis.count({
          where: { projectId: project.id },
        });
        const taskCount = await prisma.task.count({
          where: { projectId: project.id },
        });
        await prisma.coworker.update({
          where: { id: coworkerId },
          data: { isWhitelisted: false },
        });
        await expect(
          requestProjectSeoAnalysis(sourceActor, {
            ...request,
            idempotencyKey: randomUUID(),
          }),
        ).rejects.toMatchObject({ status: 409 });

        await prisma.coworker.update({
          where: { id: coworkerId },
          data: { isWhitelisted: true },
        });
        await prisma.projectSeoObservation.update({
          where: { id: observation.id },
          data: { sourceTaskId: inferred.taskId },
        });
        const configured = await requestProjectSeoAnalysis(sourceActor, {
          ...request,
          idempotencyKey: randomUUID(),
        });
        expect(
          await prisma.task.findUniqueOrThrow({
            where: { id: configured.taskId! },
          }),
        ).toMatchObject({ assigneeId: coworkerId });
        expect(
          await prisma.projectSeoAnalysis.count({
            where: { projectId: project.id },
          }),
        ).toBe(analysisCount + 1);
        expect(
          await prisma.task.count({ where: { projectId: project.id } }),
        ).toBe(taskCount + 1);
        expect(unexpectedNetwork).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        await prisma.task.deleteMany({ where: { projectId: project.id } });
        await prisma.project.delete({ where: { id: project.id } });
        await prisma.coworker.deleteMany({
          where: { id: { in: [sourceCoworkerId, replacementCoworkerId] } },
        });
      }
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
