import { randomUUID } from "node:crypto";
import { seoFullAuditPrice } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { getEnv } from "@/config/env";
import { forbidden } from "@/helpers/error";
import { jsonInput } from "@/helpers/prisma-json";
import { reportObject } from "@/helpers/project-seo-public-report";
import { parsePublicSeoArtifact } from "@/helpers/project-seo-report";
import { SEO_SERPS_NOT_READ } from "@/helpers/project-seo-report-serps";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { seoChatContext } from "@/lib/seo/chat-context";
import { seoMonitorDescription } from "@/lib/seo/monitor-plan";
import { GSC_INSPECT_TOOL } from "@/lib/seo/native-gsc-inspection";
import { GSC_PROPERTIES_TOOL } from "@/lib/seo/native-statistics";
import seo from "@/routes/v1/projects/[id]/seo";
import mountTaskEvents from "@/routes/v1/tasks/[id]/events/post";
import mountRunNow from "@/routes/v1/tasks/schedules/[id]/runs/post";
import {
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import { type NativeSeoMetrics } from "@/schemas/project-seo-native-metrics.schema";
import { AUDIT_PERFORMANCE_KIND } from "@/schemas/seo-audit-performance.schema";
import { seoAuditSearchConsoleAccessSchema } from "@/schemas/seo-task-indexing.schema";
import { expectCoreLog } from "@/test/core-log";
import {
  focusedRankingsReport,
  focusedReport,
  legacyReport,
  SEO_TEST_PAGE,
  serpRead,
  siteStrategyReport,
} from "@/test-fixtures/project-seo";
import { searchConsoleToolDescriptors } from "@/test-fixtures/seo-search-console";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";
import workerInsights from "./__tests__/fixtures/seo-seasonal-worker-insights.json";
import * as composio from "./composio-integration-tools.service";
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
import { newestSeoMonitorResults } from "./project-seo-monitor-runs";
import {
  createProjectSeoActionTask,
  requestProjectSeoAnalysis,
} from "./project-seo-operations.service";
import { saveProjectSeoBrandTerms } from "./project-seo-settings.service";
import { acknowledgeSeoReview } from "./seo-action-reviews";
import { getSeoBrief } from "./seo-audit-brief.service";
import {
  changeTaskScheduleState,
  createTaskSchedule,
  runTaskScheduleNow,
  updateTaskSchedule,
} from "./task-schedule.service";

const pendingDelivery = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("@vercel/functions", async (original) => ({
  ...(await original<typeof import("@vercel/functions")>()),
  waitUntil: (work: Promise<unknown>) => pendingDelivery.push(work),
}));

// Notification and Task events publish after the test that made them: keep them off the network of later tests.
vi.mock("@/clients/composio.client", async (original) => ({
  ...(await original<typeof import("@/clients/composio.client")>()),
  getComposio: () => ({}),
}));
vi.mock("@/helpers/notification-publish-queue", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/helpers/notification-publish-queue")
  >()),
  scheduleNotificationPublish: vi.fn(),
}));
vi.mock("@/helpers/calendar-invalidation", async (original) => ({
  ...(await original<typeof import("@/helpers/calendar-invalidation")>()),
  deliverCalendarInvalidationsNow: async () => {},
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
      // A paid check needs a balance that covers its ceiling (seo-credit-gate.postgres.test.ts).
      const credits = 10_000n * 10n ** 10n;
      const topUp = await prisma.transaction.create({
        data: { amount: credits, userId },
        select: { id: true },
      });
      await prisma.creditBucket.create({
        data: { amount: credits, userId, sourceTransactionId: topUp.id },
      });
    });
    beforeEach(async () => {
      // Each case starts after earlier dispatched checks have finished.
      const earlier = await prisma.projectSeoAnalysis.findMany({
        where: { requestedBy: userId },
        select: { taskId: true },
      });
      await prisma.task.updateMany({
        where: {
          id: {
            in: earlier.flatMap((row) => (row.taskId ? [row.taskId] : [])),
          },
          status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] },
        },
        data: { status: "COMPLETED" },
      });
    });
    afterAll(async () => {
      getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = previousDispatchEnabled;
      getEnv().SEO_ANALYSIS_EXECUTOR = previousExecutor;
      await prisma.task.deleteMany({ where: { workspaceId } });
      await prisma.creditBucket.deleteMany({ where: { userId } });
      await prisma.transaction.deleteMany({ where: { userId } });
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

    it("refuses generic schedule creation, conversion and resume for a removed audit", async () => {
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
      const audit = await prisma.seoAudit.create({
        data: {
          workspaceId,
          createdById: userId,
          name: "Removed monitor target",
        },
      });
      const page = await addProjectSeoPage(
        { ...actor, owner: { kind: "audit", id: audit.id } },
        {
          url: SEO_TEST_PAGE,
          relationship: "primary",
        },
      );
      const rule = {
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "AFTER" as const,
        targetRunCount: 2,
      };
      const blueprint = {
        name: "Generic schedule",
        rule,
        assigneeId: coworkerId,
      };
      const description = seoMonitorDescription({
        version: 2,
        auditId: audit.id,
        rule,
        scopeVersion: 0,
        analysis: requestSeoAnalysisSchema.parse({
          kind: "page_check",
          pageIds: [page.id],
          countryCode: "US",
          languageCode: "en",
          coworkerId,
          idempotencyKey: randomUUID(),
        }),
      });
      const ordinary = await createTaskSchedule(vars, blueprint);
      const monitor = await createTaskSchedule(vars, {
        ...blueprint,
        description,
      });
      await changeTaskScheduleState(vars, monitor.id, "pause");
      // A legacy paused schedule can still refer to retained history. It can be ended, never restarted.
      await prisma.seoAudit.update({
        where: { id: audit.id },
        data: { deletedAt: new Date() },
      });
      await expect(
        createTaskSchedule(vars, { ...blueprint, description }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        updateTaskSchedule(vars, ordinary.id, {
          expectedRevision: ordinary.revision,
          description,
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        changeTaskScheduleState(vars, monitor.id, "resume"),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await prisma.taskSchedule.findUniqueOrThrow({
          where: { id: ordinary.id },
        }),
      ).toMatchObject({ revision: ordinary.revision, description: null });
      expect(
        (await changeTaskScheduleState(vars, monitor.id, "end")).state,
      ).toBe("ENDED");
    });

    it("requires coverage approval before scheduling a full audit and keeps it private on Run now", async () => {
      const page = await addProjectSeoPage(actor, {
        url: "https://example.test/scheduled-coverage",
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
      const input = {
        operationId: randomUUID(),
        rule: {
          expr: "0 9 * * 1",
          timezone: "UTC",
          endsMode: "AFTER" as const,
          targetRunCount: 2,
        },
        analysis: requestSeoAnalysisSchema.parse({
          kind: "audit_full",
          fullAuditPrice: seoFullAuditPrice(),
          pageIds: [page.id],
          countryCode: "US",
          languageCode: "en",
          idempotencyKey: "monitor-template",
          searchConsolePropertyId: "sc-domain:example.test",
        }),
      };
      const schedules = () =>
        prisma.taskSchedule.count({ where: { workspaceId } });
      const before = await schedules();
      await expect(
        createProjectSeoMonitor(vars, actor, input),
      ).rejects.toMatchObject({
        status: 409,
        cause: { kind: "seo_gsc_not_connected" },
      });
      expect(await schedules()).toBe(before);
      const limited = {
        ...input,
        analysis: { ...input.analysis, allowLimitedAudit: true as const },
      };
      const created = await createProjectSeoMonitor(vars, actor, limited);
      expect((await createProjectSeoMonitor(vars, actor, limited)).id).toBe(
        created.id,
      );
      await expect(
        createProjectSeoMonitor(vars, actor, input),
      ).rejects.toMatchObject({
        cause: { kind: "schedule_operation_conflict" },
      });
      const schedule = await prisma.taskSchedule.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(schedule.description).not.toMatch(
        /sc-domain:|allowLimitedAudit|searchConsolePropertyId/,
      );
      const generic = {
        operationId: randomUUID(),
        name: "ordinary",
        visibility: "PUBLIC" as const,
        projectId,
        assigneeId: coworkerId,
        rule: input.rule,
      };
      await expect(
        createTaskSchedule(vars, {
          ...generic,
          description: schedule.description,
        }),
      ).rejects.toMatchObject({ status: 409 });
      const ordinary = await createTaskSchedule(vars, generic);
      await expect(
        updateTaskSchedule(vars, ordinary.id, {
          expectedRevision: ordinary.revision,
          description: schedule.description,
        }),
      ).rejects.toMatchObject({ status: 409 });
      const run = await runTaskScheduleNow(vars, created.id, {
        expectedRevision: created.revision,
      });
      const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
        where: { taskId: run.run.releasedTaskId! },
      });
      expect(analysis.request).toMatchObject({ searchConsoleAccess: null });
      const task = await prisma.task.findUniqueOrThrow({
        where: { id: analysis.taskId! },
      });
      expect(task.description).not.toMatch(/sc-domain:|searchConsoleAccess/);
    });

    it("pins the verified monitor property privately and blocks later Runs after consent is replaced", async () => {
      const url = "https://example.test/verified-monitor";
      const property = "sc-domain:example.test";
      const page = await addProjectSeoPage(actor, {
        url,
        relationship: "primary",
      });
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
      let currentProperty = property;
      const descriptors = vi
        .spyOn(composio, "listIntegrationTools")
        .mockResolvedValue(searchConsoleToolDescriptors());
      const read = vi
        .spyOn(composio, "readIntegrationTool")
        .mockImplementation(async (_account, slug) =>
          slug === GSC_PROPERTIES_TOOL
            ? {
                siteEntry: [
                  { siteUrl: currentProperty, permissionLevel: "siteOwner" },
                ],
              }
            : slug === GSC_INSPECT_TOOL
              ? { inspectionResult: { indexStatusResult: { verdict: "PASS" } } }
              : { rows: [] },
        );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("offline test");
        }),
      );
      try {
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
          analysis: requestSeoAnalysisSchema.parse({
            kind: "audit_full",
            includeSitemaps: true,
            pageIds: [page.id],
            fullAuditPrice: seoFullAuditPrice(),
            countryCode: "US",
            languageCode: "en",
            idempotencyKey: "monitor-template",
          }),
        };
        const monitor = await createProjectSeoMonitor(vars, actor, input);
        const schedule = await prisma.taskSchedule.findUniqueOrThrow({
          where: { id: monitor.id },
        });
        expect(schedule.description).not.toContain(property);
        expect(schedule.description).not.toContain("includeSitemaps");
        const saved = await prisma.projectSeoObservation.findFirstOrThrow({
          where: {
            sourceKey: `monitor-approval:${monitor.id}`,
            projectId,
            visibility: "PRIVATE",
            ownerId: userId,
          },
        });
        const access = seoAuditSearchConsoleAccessSchema.parse(
          (saved.payload as Record<string, unknown>).searchConsoleAccess,
        );
        expect(access.includeSitemaps).toBe(true);
        const workspace = await getProjectSeoWorkspace(actor, {
          pageId: page.id,
        });
        for (const projection of [
          JSON.stringify(workspace),
          JSON.stringify(await getSeoBrief(actor)),
          seoChatContext(workspace, "personal"),
        ]) {
          expect(projection).not.toContain(access.connectionVersion);
          expect(projection).not.toContain(saved.sourceKey);
        }
        const runs = await prisma.taskScheduleRun.findMany({
          where: { scheduleId: monitor.id, state: "PLANNED" },
          orderBy: { effectiveScheduledAt: "asc" },
        });
        expect(runs).toHaveLength(2);
        const release = (index: number) =>
          prisma.$transaction((tx) =>
            releaseSeoMonitorRun(tx, schedule, runs[index].id),
          );
        const first = await release(0);
        const dispatched = await prisma.projectSeoAnalysis.findUniqueOrThrow({
          where: { taskId: first!.id },
        });
        expect(dispatched.request).toMatchObject({
          searchConsoleAccess: {
            propertyId: property,
            connectionVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
            includeSitemaps: true,
          },
        });
        const app = createTaskScheduleTestApp(
          mountTaskEvents,
          { actor: "coworker", coworkerId, vendorId },
          null,
        );
        const start = (taskId = first!.id) =>
          app.request(
            `http://localhost/${taskId}/events/context-v1`,
            jsonRequest("POST", {
              status: "RUNNING",
              expectedContext: {
                ownerId: userId,
                organizationId: null,
                workspaceId,
              },
            }),
          );
        const transactions = () =>
          prisma.transaction.count({ where: { userId } });
        const before = await transactions();
        read.mockResolvedValueOnce({ siteEntry: [] });
        const rejected = await start();
        expect(rejected.status).toBe(409);
        const response = await rejected.json();
        expect(response.message).toContain("Review the audit");
        expect(JSON.stringify(response)).not.toContain(property);
        expect(
          (await prisma.task.findUniqueOrThrow({ where: { id: first!.id } }))
            .status,
        ).toBe("READY");
        expect(await transactions()).toBe(before);
        const repaired = await start();
        expect(repaired.status).toBe(201);
        expect(await transactions()).toBe(before);
        await Promise.all(pendingDelivery.splice(0));
        const performance = await prisma.projectSeoObservation.findFirst({
          where: { sourceTaskId: first!.id, kind: AUDIT_PERFORMANCE_KIND },
        });
        expect(performance).toMatchObject({
          ownerId: userId,
          visibility: "PRIVATE",
          payload: {
            provider: "search_console",
            propertyId: property,
            pageUrls: [url],
          },
        });
        await prisma.task.update({
          where: { id: first!.id },
          data: { status: "COMPLETED" },
        });
        const manualApp = createTaskScheduleTestApp(
          mountRunNow,
          vars.authContext,
          vars.workspaceContext,
        );
        const manualRun = (choice: object = {}) =>
          manualApp.request(
            `http://localhost/schedules/${schedule.id}/runs`,
            jsonRequest("POST", {
              expectedRevision: schedule.revision,
              ...choice,
            }),
          );
        const runCounts = async () => ({
          runs: await prisma.taskScheduleRun.count({
            where: { scheduleId: schedule.id },
          }),
          tasks: await prisma.task.count({
            where: { scheduleId: schedule.id },
          }),
          transactions: await transactions(),
          revision: (
            await prisma.taskSchedule.findUniqueOrThrow({
              where: { id: schedule.id },
            })
          ).revision,
        });
        const beforeManual = await runCounts();
        read.mockResolvedValueOnce({ siteEntry: [] });
        const refused = await manualRun({ origin: "cmo-subscription" });
        expect(refused.status).toBe(409);
        expect((await refused.json()).kind).toBe("seo_gsc_property");
        expect(await runCounts()).toEqual(beforeManual);
        read.mockRejectedValueOnce(new Error("private upstream failure"));
        expectCoreLog("warn", "Search Console verification failed");
        const unavailable = await manualRun();
        expect(unavailable.status).toBe(409);
        const problem = await unavailable.json();
        expect(problem.kind).toBe("seo_gsc_unavailable");
        expect(JSON.stringify(problem)).not.toContain(
          "private upstream failure",
        );
        expect(await runCounts()).toEqual(beforeManual);
        const replaceConsent = async () => {
          await prisma.seoConnection.update({
            where: { id: connection.id },
            data: {
              composioAccountId: randomUUID(),
              revision: { increment: 1 },
            },
          });
          return {
            siteEntry: [
              { siteUrl: currentProperty, permissionLevel: "siteOwner" },
            ],
          };
        };
        read.mockImplementationOnce(replaceConsent);
        const changedDuringCheck = await manualRun();
        expect(changedDuringCheck.status).toBe(409);
        expect((await changedDuringCheck.json()).kind).toBe(
          "seo_gsc_unavailable",
        );
        expect(await runCounts()).toEqual(beforeManual);

        // A new manual Run may pin a newly connected account. The recurring approval remains the original one.
        const reconnected = await manualRun();
        expect(reconnected.status).toBe(201);
        const reconnectedTask = (await reconnected.json()).data.run
          .releasedTaskId;
        const proofFor = async (taskId: string) => {
          const row = await prisma.projectSeoAnalysis.findUniqueOrThrow({
            where: { taskId },
          });
          return seoAuditSearchConsoleAccessSchema.parse(
            (row.request as Record<string, unknown>).searchConsoleAccess,
          );
        };
        const newAccount = await proofFor(reconnectedTask);
        expect(newAccount.includeSitemaps).toBeUndefined();
        expect(newAccount.propertyId).toBe(property);
        expect(newAccount.connectionVersion).not.toBe(access.connectionVersion);
        await prisma.task.update({
          where: { id: reconnectedTask },
          data: { status: "COMPLETED" },
        });
        currentProperty = "https://example.test/";
        const currentRevision = schedule.revision + 1;
        const alternate = {
          searchConsolePropertyId: currentProperty,
          expectedRevision: currentRevision,
        };
        const attempts = await Promise.all([
          manualRun(alternate),
          manualRun(alternate),
        ]);
        expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
        const manual = await attempts.find((r) => r.status === 201)!.json();
        const manualTaskId = manual.data.run.releasedTaskId;
        expect(await proofFor(manualTaskId)).toEqual({
          ...newAccount,
          propertyId: currentProperty,
        });
        expect(
          (
            await prisma.projectSeoObservation.findUniqueOrThrow({
              where: { id: saved.id },
            })
          ).payload,
        ).toEqual({ searchConsoleAccess: access });
        expect(await runCounts()).toEqual({
          ...beforeManual,
          runs: beforeManual.runs + 2,
          tasks: beforeManual.tasks + 2,
          revision: schedule.revision + 2,
        });
        // Consent changes after the worker's first transaction and before its RUNNING write.
        read.mockImplementationOnce(replaceConsent);
        const stale = await start(manualTaskId);
        expect(stale.status).toBe(409);
        expect(await transactions()).toBe(before);
        expect(
          (await prisma.task.findUniqueOrThrow({ where: { id: manualTaskId } }))
            .status,
        ).toBe("READY");
        await prisma.task.update({
          where: { id: manualTaskId },
          data: { status: "CANCELED" },
        });
        read.mockClear();
        expect((await createProjectSeoMonitor(vars, actor, input)).id).toBe(
          monitor.id,
        );
        await expect(release(1)).rejects.toMatchObject({
          cause: { kind: "seo_gsc_unavailable" },
        });
        expect(read).not.toHaveBeenCalled();
        expect(
          await prisma.task.count({ where: { scheduleId: monitor.id } }),
        ).toBe(3);
      } finally {
        vi.unstubAllGlobals();
        read.mockRestore();
        descriptors.mockRestore();
        await prisma.seoConnection.delete({ where: { id: connection.id } });
      }
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
      await prisma.task.update({
        where: { id: first!.id },
        data: { status: "COMPLETED" },
      });
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
      await prisma.task.update({
        where: { id: second!.id },
        data: { status: "COMPLETED" },
      });
      // A schedule can repeat the full audit: each Run's Task carries the seo_audit packet.
      const fullMonitor = await createProjectSeoMonitor(vars, actor, {
        ...input,
        operationId: randomUUID(),
        analysis: requestSeoAnalysisSchema.parse({
          ...analysis,
          kind: "audit_full",
          fullAuditPrice: seoFullAuditPrice(),
          devices: ["mobile", "desktop"],
          idempotencyKey: "monitor-full-audit",
          allowLimitedAudit: true,
        }),
      });
      const fullRun = await prisma.taskScheduleRun.findFirstOrThrow({
        where: { scheduleId: fullMonitor.id, state: "PLANNED" },
        orderBy: { effectiveScheduledAt: "asc" },
      });
      const fullTask = await prisma.$transaction(async (tx) =>
        releaseSeoMonitorRun(
          tx,
          await tx.taskSchedule.findUniqueOrThrow({
            where: { id: fullMonitor.id },
          }),
          fullRun.id,
        ),
      );
      expect(
        (
          await prisma.task.findUniqueOrThrow({
            where: { id: fullTask?.id ?? "missing" },
          })
        ).description,
      ).toMatch(
        /^Full SEO audit of \d+ selected pages?:\n[\s\S]*\nseo_audit: \{.*\}$/,
      );
      // The step and the end date are part of the approved rule too.
      for (const tampered of [
        { intervalDays: 2 },
        { endsOn: new Date("2030-01-01T00:00:00.000Z") },
      ])
        await expect(
          prisma.$transaction((tx) =>
            releaseSeoMonitorRun(tx, { ...schedule, ...tampered }, runs[0].id),
          ),
        ).rejects.toMatchObject({ status: 403 });
      await prisma.task.update({
        where: { id: fullTask!.id },
        data: { status: "COMPLETED" },
      });
      // Every N days up to a date, as the schedule dialog writes it: the guard lets its Runs start.
      const day = 86_400_000;
      const every = await createProjectSeoMonitor(vars, actor, {
        ...input,
        operationId: randomUUID(),
        rule: {
          expr: "0 9 * * *",
          timezone: "UTC",
          intervalDays: 3,
          anchorAt: new Date(Date.now() + day).toISOString(),
          endsMode: "ON",
          endsOn: new Date(Date.now() + 30 * day).toISOString(),
          targetRunCount: null,
        },
      });
      const everySchedule = await prisma.taskSchedule.findUniqueOrThrow({
        where: { id: every.id },
      });
      expect(everySchedule).toMatchObject({ intervalDays: 3, endsMode: "ON" });
      const everyRun = await prisma.taskScheduleRun.findFirstOrThrow({
        where: { scheduleId: every.id, state: "PLANNED" },
      });
      // The anchor sets the days of an every-N-days rule: a moved anchor is a changed rule.
      await expect(
        prisma.$transaction((tx) =>
          releaseSeoMonitorRun(
            tx,
            {
              ...everySchedule,
              anchorAt: new Date(everySchedule.anchorAt.getTime() + day),
            },
            everyRun.id,
          ),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await prisma.$transaction((tx) =>
          releaseSeoMonitorRun(tx, everySchedule, everyRun.id),
        ),
      ).toBeTruthy();
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
      // A sibling monitor of the same owner, with one Run, for the batched read below.
      const sibling = await createProjectSeoMonitor(vars, actor, {
        operationId: randomUUID(),
        rule: {
          expr: "0 9 * * *",
          timezone: "UTC",
          endsMode: "AFTER",
          targetRunCount: 2,
        },
        analysis: requestSeoAnalysisSchema.parse({
          kind: "page_check",
          pageIds: [page.id],
          countryCode: "US",
          languageCode: "en",
          devices: ["desktop"],
          coworkerId,
          idempotencyKey: "monitor-ux-sibling",
        }),
      });
      const siblingRun = await runTaskScheduleNow(vars, sibling.id, {
        expectedRevision: sibling.revision,
      });
      await prisma.task.update({
        where: { id: siblingRun.run.releasedTaskId! },
        data: { status: "COMPLETED" },
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
      await prisma.task.update({
        where: { id: scheduled!.id },
        data: { status: "COMPLETED" },
      });
      const ranNow = await runTaskScheduleNow(vars, monitor.id, {
        expectedRevision: edited.revision,
      });
      expect(ranNow.run.manual).toBe(true);
      await prisma.task.update({
        where: { id: ranNow.run.releasedTaskId! },
        data: { status: "COMPLETED" },
      });
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
      // An Owner without access to the Workspace gets no notification for the same worse result.
      const worseRow = await prisma.projectSeoObservation.findFirstOrThrow({
        where: { sourceTaskId: againTaskId },
      });
      await prisma.taskSchedule.update({
        where: { id: monitor.id },
        data: { ownerId: otherId },
      });
      try {
        await notifySeoMonitorWorse(againTaskId, worseRow.id);
      } finally {
        await prisma.taskSchedule.update({
          where: { id: monitor.id },
          data: { ownerId: userId },
        });
      }
      expect(
        await prisma.notification.count({
          where: { userId: otherId, messageKey: SEO_MONITOR_WORSE_MESSAGE_KEY },
        }),
      ).toBe(0);
      // A second file of the same Run counts once: the change still compares against the Run before, and the Owner
      // gets no second notification for the Run.
      const secondFile = await result(
        againTaskId,
        "2026-11-03T10:00:00.000Z",
        "fired",
      );
      await notifySeoMonitorWorse(againTaskId, secondFile.id);
      expect(await worse()).toBe(1);
      // A late result of the oldest Run keeps that Run's place: the pair stays the two newest Runs.
      await result(scheduled!.id, "2026-11-04T09:00:00.000Z", "pass");

      // The sibling's one failed result must not pair with this monitor's passed results.
      await result(
        siblingRun.run.releasedTaskId!,
        "2026-11-05T09:00:00.000Z",
        "fired",
      );

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
      // Each stored result is one history entry: three Runs, two of them with two files.
      expect(
        workspace.runs?.filter((run) => run.monitorId === monitor.id),
      ).toHaveLength(5);
      // The batched read keeps each monitor's own Runs: the sibling shows its own last Run and no change from this
      // monitor's results.
      expect(
        workspace.monitors.find((item) => item.id === sibling.id),
      ).toMatchObject({
        lastRun: { taskId: siblingRun.run.releasedTaskId },
        change: null,
      });
      // A Run with many files keeps the Run before it in the pair: the result read returns one row per Run.
      for (let second = 0; second <= 50; second++)
        await result(
          againTaskId,
          new Date(Date.UTC(2026, 10, 3, 11, 0, second)).toISOString(),
          "fired",
        );
      const pair = await newestSeoMonitorResults(actor, [
        againTaskId,
        ranNow.run.releasedTaskId!,
      ]);
      expect(pair.map((item) => item.observedAt.toISOString())).toEqual([
        "2026-11-03T11:00:50.000Z",
        "2026-11-02T09:00:00.000Z",
      ]);
      // A Run whose first file was not worse still notifies once when a later file is worse, and only once.
      const ranNowTaskId = ranNow.run.releasedTaskId!;
      for (const at of ["2026-11-02T10:00:00.000Z", "2026-11-02T11:00:00.000Z"])
        await notifySeoMonitorWorse(
          ranNowTaskId,
          (await result(ranNowTaskId, at, "fired")).id,
        );
      expect(await worse()).toBe(2);
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
        await prisma.task.update({
          where: { id: inferred.taskId! },
          data: { status: "COMPLETED" },
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

    it("keeps a completed analysis when a concurrent invalid report finishes later", async () => {
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
          idempotencyKey: "concurrent-invalid-report",
          coworkerId,
        }),
      );
      const taskId = analysis.taskId;
      if (!taskId) throw new Error("The Analysis did not create a Task");
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "COMPLETED" },
      });
      const body = JSON.stringify({
        ...focusedReport(),
        requestId: analysis.id,
      });
      const [valid, invalid] = await Promise.all(
        ["valid", "invalid"].map((name) =>
          prisma.taskFile.create({
            data: {
              taskId,
              name: `seo-report-${taskId}.json`,
              fileUrl: `https://seo-test.public.blob.vercel-storage.com/tasks/${taskId}/${name}.json`,
              mimeType: "application/json",
              size: BigInt(Buffer.byteLength(body)),
              uploadedByCoworkerId: coworkerId,
            },
          }),
        ),
      );
      const invalidRead = Promise.withResolvers<void>();
      const invalidResponse = Promise.withResolvers<Response>();
      vi.stubGlobal("fetch", async (url: string) => {
        if (url === invalid.fileUrl) {
          invalidRead.resolve();
          return invalidResponse.promise;
        }
        return new Response(body);
      });
      const invalidImport = reconcileProjectSeoTaskFile(taskId, invalid.id);
      try {
        await invalidRead.promise;
        await reconcileProjectSeoTaskFile(taskId, valid.id);
        expect(
          await prisma.projectSeoAnalysis.findUniqueOrThrow({
            where: { id: analysis.id },
            select: { status: true },
          }),
        ).toEqual({ status: "completed" });
        invalidResponse.resolve(new Response("not JSON"));
        await invalidImport;
        expect(
          await prisma.projectSeoAnalysis.findUniqueOrThrow({
            where: { id: analysis.id },
            select: { status: true, failureReason: true },
          }),
        ).toEqual({ status: "completed", failureReason: null });
        expect(
          await prisma.projectSeoObservation.count({
            where: { sourceTaskId: taskId, sourceFileId: valid.id },
          }),
        ).toBe(1);
      } finally {
        invalidResponse.resolve(new Response("not JSON"));
        await invalidImport;
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

    it("keeps an audit beside 150 newer metric snapshots", async () => {
      const page = await addProjectSeoPage(actor, {
        url: "https://example.test/metrics-flood",
        relationship: "primary",
      });
      const audit = await prisma.projectSeoObservation.create({
        data: {
          projectId,
          source: "seo_coworker",
          kind: "audit_full",
          sourceKey: randomUUID(),
          pageIds: [page.id],
          artifactHash: "metrics-flood-audit",
          payload: parsePublicSeoArtifact({
            ...legacyReport(),
            request: { url: page.url },
          }),
          observedAt: new Date("2026-10-01T00:00:00Z"),
        },
      });
      await prisma.projectSeoObservation.createMany({
        data: Array.from({ length: 150 }, (_, index) => ({
          projectId,
          ownerId: userId,
          visibility: "PRIVATE",
          source: "ga4",
          kind: "metrics",
          sourceKey: `metrics-flood:${index}`,
          pageIds: [page.id],
          artifactHash: `metrics-flood:${index}`,
          payload: metrics([page.url]),
          observedAt: new Date(Date.UTC(2026, 10, 1, 0, index)),
        })),
      });
      const ids = (
        await getProjectSeoWorkspace(actor, { pageId: page.id })
      ).observations.map((row) => row.id);
      expect(ids).toContain(audit.id);
    });

    it("rechecks a completed recommendation across 101 focused checks and 101 private syncs outside the visible history", async () => {
      const page = await addProjectSeoPage(actor, {
        url: "https://example.test/returning-query",
        relationship: "primary",
      });
      const raw = legacyReport(),
        keyword = "manual repair";
      const ranked = (
        at: string,
        pos: number,
        hash: string,
        trigger: boolean,
        decisionId = "returning",
      ) => {
        const snapshotId = hash.repeat(64);
        return parsePublicSeoArtifact({
          ...raw,
          request: { url: page.url },
          snapshotId,
          header: { ...raw.header, capturedAt: at },
          rankingData: {
            ...raw.rankingData,
            source: "DataForSEO Labs and Backlinks API",
            page: {
              ...raw.rankingData.page,
              rankedResult: "ok",
              ranked: {
                rows: [
                  {
                    url: page.url,
                    keyword,
                    position: pos,
                    intent: null,
                    volume: 120,
                  },
                ],
              },
            },
          },
          strategyDecisions: trigger
            ? [
                {
                  id: decisionId,
                  kind: "content_opportunity",
                  targetUrl: page.url,
                  action: "Review the repair instructions.",
                  reason: "This page ranked near the top ten.",
                  alternative: "Keep the existing instructions.",
                  nextCheck: "Compare the page rank on the next audit.",
                  evidence: [snapshotId, "rankingData.page.ranked"],
                },
              ]
            : [],
          rankReviewTriggers: trigger
            ? [
                {
                  decisionId,
                  kind: "rank_crosses",
                  keyword,
                  position: pos,
                  boundary: 10,
                },
              ]
            : [],
        });
      };
      const origin = await storeResult(
        page.id,
        ranked("2026-08-01T12:00:00.000Z", 13, "a", true),
      );
      const initial = await getProjectSeoWorkspace(actor, { pageId: page.id });
      const action = initial.actions.find((a) => a.decision)!;
      const task = await createProjectSeoActionTask(actor, {
        observationId: origin.id,
        actionId: action.id,
        idempotencyKey: "buried-review",
      });
      const completedAt = new Date("2026-09-01T12:00:00.000Z");
      await prisma.task.update({
        where: { id: task.taskId },
        data: {
          status: "COMPLETED",
          events: {
            create: { status: "COMPLETED", userId, createdAt: completedAt },
          },
        },
      });
      const unlinked = await storeResult(
        page.id,
        ranked("2026-08-03T12:00:00.000Z", 13, "e", true, "unlinked"),
      );
      const stale = (
        await getProjectSeoWorkspace(actor, { pageId: page.id })
      ).actions.find((a) => a.decision && a.id !== action.id)!;
      const check = parsePublicSeoArtifact({
        ...focusedReport(),
        scope: { ...focusedReport().scope, pageUrls: [page.url] },
        checks: [],
      });
      const common = {
        projectId,
        pageIds: [page.id],
        artifactHash: "review-noise",
        observedAt: new Date("2026-10-01T12:00:00Z"),
      };
      await prisma.projectSeoObservation.createMany({
        data: Array.from({ length: 101 }, (_, n) => [
          {
            ...common,
            sourceKey: "review-check:" + n,
            source: "seo_coworker",
            kind: "page_check",
            payload: check,
          },
          {
            ...common,
            sourceKey: "review-metric:" + n,
            source: "ga4",
            kind: "metrics",
            ownerId: userId,
            visibility: "PRIVATE" as const,
            payload: metrics([page.url]),
          },
        ]).flat(),
      });
      const later = await storeResult(
        page.id,
        ranked("2026-11-01T12:00:00.000Z", 8, "b", false),
      );
      const workspace = await getProjectSeoWorkspace(actor, {
        pageId: page.id,
      });
      expect(workspace.observations.map((o) => o.id)).not.toContain(origin.id);
      expect(workspace.actions.filter((a) => a.id === action.id)).toMatchObject(
        [
          {
            taskId: task.taskId,
            status: "implemented",
            observationId: origin.id,
            followUpReview: {
              baselineObservationId: origin.id,
              observationId: later.id,
              before: 13,
              after: 8,
              keyword,
            },
          },
        ],
      );
      expect(workspace.actions.find((a) => a.id === stale.id)?.status).toBe(
        "needs_review",
      );
      await expect(
        createProjectSeoActionTask(actor, {
          actionId: stale.id,
          observationId: unlinked.id,
          idempotencyKey: "stale-draft",
        }),
      ).rejects.toMatchObject({ status: 409 });
      const staleReview = workspace.actions.find((a) => a.id === stale.id)!
        .followUpReview!;
      await acknowledgeSeoReview(actor, {
        pageId: page.id,
        actionId: stale.id,
        kind: staleReview.kind,
        baselineObservationId: staleReview.baselineObservationId,
        observationId: staleReview.observationId,
      });
      const cleared = await getProjectSeoWorkspace(actor, { pageId: page.id });
      expect(cleared.actions.some((a) => a.id === stale.id)).toBe(false);
      expect(
        cleared.actions.find((a) => a.id === action.id)?.followUpReview,
      ).toBeDefined();
      expect(
        await prisma.projectSeoActionTask.count({
          where: { projectId, actionId: stale.id },
        }),
      ).toBe(0);
      // Even a hundred more full audits cannot push an accepted origin out of the separate tracked set.
      const otherFull = ranked("2026-10-15T12:00:00.000Z", 18, "c", false);
      await prisma.projectSeoObservation.createMany({
        data: Array.from({ length: 101 }, (_, n) => ({
          ...common,
          sourceKey: "review-full:" + n,
          source: "seo_coworker",
          kind: "audit_full",
          payload: otherFull,
          observedAt: new Date(Date.parse(otherFull.observedAt) + n * 60000),
        })),
      });
      // A private owner's row cannot undo this public review with an apparently newer rank.
      await storeResult(
        page.id,
        ranked("2026-11-03T12:00:00.000Z", 16, "d", false),
        { ownerId: otherId },
      );
      const beyondFullLimit = await getProjectSeoWorkspace(actor, {
        pageId: page.id,
      });
      expect(
        beyondFullLimit.actions.filter((a) => a.id === action.id),
      ).toMatchObject([
        {
          taskId: task.taskId,
          followUpReview: {
            baselineObservationId: origin.id,
            observationId: later.id,
          },
        },
      ]);
      const historical = await getProjectSeoWorkspace(actor, {
        pageId: page.id,
        to: "2026-10-15",
      });
      expect(historical.actions.some((a) => a.followUpReview)).toBe(false);
      const review = beyondFullLimit.actions.find((a) => a.id === action.id)!
        .followUpReview!;
      const receipt = {
        pageId: page.id,
        actionId: action.id,
        kind: review.kind,
        baselineObservationId: origin.id,
        observationId: later.id,
      };
      const wrongPage = await addProjectSeoPage(actor, {
        url: "https://example.test/unrelated-review",
        relationship: "primary",
      });
      await expect(
        acknowledgeSeoReview(actor, { ...receipt, pageId: wrongPage.id }),
      ).rejects.toThrow(/changed/);
      await expect(
        acknowledgeSeoReview(actor, { ...receipt, observationId: origin.id }),
      ).rejects.toThrow(/changed/);
      await expect(
        acknowledgeSeoReview(
          { ...actor, workspaceId: otherWorkspaceId, userId: otherId },
          receipt,
        ),
      ).rejects.toThrow();
      await Promise.all([
        acknowledgeSeoReview(actor, receipt),
        acknowledgeSeoReview(actor, receipt),
      ]);
      await storeResult(
        page.id,
        ranked("2026-11-02T12:00:00.000Z", 7, "1", false),
      );
      await acknowledgeSeoReview(actor, receipt);
      const closed = await getProjectSeoWorkspace(actor, { pageId: page.id });
      const accepted = closed.actions.find((a) => a.id === action.id)!;
      expect(accepted.followUpReview).toBeUndefined();
      expect(accepted.taskId).toBe(task.taskId);
      expect(
        closed.observations.some((o) => o.kind === "recommendation_review"),
      ).toBe(false);
      expect(
        await prisma.projectSeoObservation.count({
          where: { projectId, kind: "recommendation_review" },
        }),
      ).toBe(2);
      await storeResult(
        page.id,
        ranked("2026-11-04T12:00:00.000Z", 16, "e", false),
      );
      const fresh = await storeResult(
        page.id,
        ranked("2026-11-06T12:00:00.000Z", 7, "f", false),
      );
      await acknowledgeSeoReview(actor, receipt); // a replay cannot silence the later crossing.
      const reopened = await getProjectSeoWorkspace(actor, { pageId: page.id });
      expect(
        reopened.actions.find((a) => a.id === action.id)?.followUpReview
          ?.observationId,
      ).toBe(fresh.id);
      // The owner can review the exact episode shown by a past-date filter even after a later reversal.
      await storeResult(
        page.id,
        ranked("2026-11-08T12:00:00.000Z", 15, "9", false),
      );
      const view = { pageId: page.id, to: "2026-11-06" };
      const past = await getProjectSeoWorkspace(actor, view);
      const episode = past.actions.find((a) => a.id === action.id)!
        .followUpReview!;
      expect(episode.observationId).toBe(fresh.id);
      await acknowledgeSeoReview(actor, {
        ...receipt,
        baselineObservationId: episode.baselineObservationId,
        observationId: fresh.id,
        view,
      });
      expect(
        (await getProjectSeoWorkspace(actor, view)).actions.find(
          (a) => a.id === action.id,
        )?.followUpReview,
      ).toBeUndefined();
      expect(
        await prisma.projectSeoActionTask.count({
          where: { projectId, actionId: action.id },
        }),
      ).toBe(1);
    });

    it("marks the history limited only when one load reaches its own cap", async () => {
      const page = await addProjectSeoPage(actor, {
        url: "https://example.test/history-split",
        relationship: "primary",
      });
      const payload = parsePublicSeoArtifact({
        ...legacyReport(),
        request: { url: page.url },
      });
      const audits = (from: number, count: number) =>
        prisma.projectSeoObservation.createMany({
          data: Array.from({ length: count }, (_, index) => ({
            projectId,
            source: "seo_coworker",
            kind: "audit_full",
            sourceKey: `history-split-audit:${from + index}`,
            pageIds: [page.id],
            artifactHash: "history-split-audit",
            payload,
            observedAt: new Date(Date.UTC(2026, 9, 1, 0, from + index)),
          })),
        });
      const syncs = (from: number, count: number) =>
        prisma.projectSeoObservation.createMany({
          data: Array.from({ length: count }, (_, index) => ({
            projectId,
            ownerId: userId,
            visibility: "PRIVATE" as const,
            source: "ga4",
            kind: "metrics",
            sourceKey: `history-split-sync:${from + index}`,
            pageIds: [page.id],
            artifactHash: `history-split-sync:${from + index}`,
            payload: metrics([page.url]),
            observedAt: new Date(Date.UTC(2026, 10, 1, 0, from + index)),
          })),
        });
      await audits(0, 60);
      await syncs(0, 40);
      const history = async () =>
        (await getProjectSeoWorkspace(actor, { pageId: page.id })).history;
      // 100 rows in all, but neither load reached its own cap of 100.
      expect(await history()).toEqual({
        limit: 100,
        limited: false,
        evidenceLimited: false,
      });
      // 100 syncs cut the syncs only: every check still loads.
      await syncs(40, 60);
      expect(await history()).toEqual({
        limit: 100,
        limited: true,
        evidenceLimited: false,
      });
      await audits(60, 40);
      expect(await history()).toEqual({
        limit: 100,
        limited: true,
        evidenceLimited: true,
      });
    });

    it("keeps the newest saved brand terms, even a list saved before", async () => {
      const page = await addProjectSeoPage(actor, {
        url: "https://example.test/brand-terms",
        relationship: "primary",
      });
      await saveProjectSeoBrandTerms(actor, {
        terms: ["Acme", "acme", "ACME Shop"],
      });
      await saveProjectSeoBrandTerms(actor, { terms: ["Other"] });
      await saveProjectSeoBrandTerms(actor, { terms: ["Acme", "ACME Shop"] });
      const workspace = await getProjectSeoWorkspace(actor, {
        pageId: page.id,
      });
      expect(workspace.brandTerms).toEqual(["Acme", "ACME Shop"]);
      const settings = () =>
        prisma.projectSeoObservation.findMany({
          where: { projectId, kind: "settings" },
          select: { id: true },
        });
      // Only the newest list is kept, and saving it again writes nothing.
      const [kept] = await settings();
      expect(await settings()).toHaveLength(1);
      await saveProjectSeoBrandTerms(actor, { terms: ["Acme", "ACME Shop"] });
      expect(await settings()).toEqual([kept]);
      // A settings row covers no page: it is never read as audit evidence.
      expect(
        workspace.observations.some((row) => row.kind === "settings"),
      ).toBe(false);
    });

    it("drafts one Task for a supported seasonal page update and reuses it after a repeat audit", async () => {
      const project = await prisma.project.create({
        data: { workspaceId, name: "Seasonal timing fixture" },
      });
      const seasonalActor: SeoActor = {
        ...actor,
        owner: { kind: "project", id: project.id },
      };
      vi.useFakeTimers({ toFake: ["Date"] });
      onTestFinished(() => {
        vi.useRealTimers();
      });
      vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
      async function seasonalAudit(audience: string, seasonYear = 2026) {
        const task = await prisma.task.create({
          data: {
            name: "Public seasonal audit",
            ownerId: userId,
            workspaceId,
            status: "COMPLETED",
            assigneeId: coworkerId,
          },
        });
        const report = legacyReport();
        const body = JSON.stringify({
          ...report,
          header: { ...report.header, capturedAt: new Date().toISOString() },
          seasonalReview: {
            status: { demand: "completed", audience: "completed" },
            insights: workerInsights.map((row) => ({
              ...row,
              audience,
              asOf: `${seasonYear}-11-01`,
              windows: row.windows.map((w) => ({
                ...w,
                targetPeriod: `${seasonYear}-12`,
                historicalPeriod: `${seasonYear - 1}-12`,
              })),
              demand: {
                ...row.demand,
                months: row.demand.months.map((m) => ({
                  ...m,
                  year: m.year + seasonYear - 2026,
                })),
              },
              url: report.request.url,
              country: report.header.market.country,
              language: report.header.market.language,
            })),
          },
        });
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
        return importProjectSeoAudit(
          seasonalActor,
          { taskId: task.id, fileId: file.id },
          { fetchImpl: async () => new Response(body) },
        );
      }
      const first = await seasonalAudit("Bootsbesitzer");
      const workspace = await getProjectSeoWorkspace(seasonalActor, {});
      const idea = workspace.seasonalIdeas?.find((row) => row.actionId);
      const action = workspace.actions.find((a) => a.id === idea?.actionId);
      expect(action).toMatchObject({ observationId: first.id });
      if (!action) return;
      const input = {
        observationId: action.observationId,
        actionId: action.id,
        idempotencyKey: "seasonal-accept",
      };
      vi.setSystemTime(new Date("2027-01-02T12:00:00Z"));
      await expect(
        createProjectSeoActionTask(seasonalActor, input),
      ).rejects.toThrow(/seasonal window has passed/i);
      expect(
        (await getProjectSeoWorkspace(seasonalActor, {})).actions.find(
          (a) => a.id === action.id,
        ),
      ).toBeUndefined();
      vi.setSystemTime(new Date("2026-12-31T12:00:00Z"));
      await expect(
        createProjectSeoActionTask(
          { ...seasonalActor, userId: otherId, workspaceId: otherWorkspaceId },
          input,
        ),
      ).rejects.toMatchObject({ status: 404 });
      const link = await createProjectSeoActionTask(seasonalActor, input);
      const task = await prisma.task.findUniqueOrThrow({
        where: { id: link.taskId },
      });
      expect(task).toMatchObject({ status: "DRAFT", name: action.title });
      for (const line of action.evidence)
        expect(task.description).toContain(line);
      expect(task.description).not.toMatch(
        /reviewer|bbbbbbbb|Compare a later Search Console period/,
      );
      const repeat = await seasonalAudit("Segler");
      expect(repeat.id).not.toBe(first.id);
      vi.setSystemTime(new Date("2027-01-02T12:00:00Z"));
      expect(
        (await createProjectSeoActionTask(seasonalActor, input)).taskId,
      ).toBe(link.taskId);
      const again = await getProjectSeoWorkspace(seasonalActor, {});
      expect(again.actions.filter((a) => a.id === action.id)).toEqual([
        expect.objectContaining({
          taskId: link.taskId,
          status: "task_created",
        }),
      ]);
      expect(
        (
          await createProjectSeoActionTask(seasonalActor, {
            ...input,
            observationId: repeat.id,
            idempotencyKey: "seasonal-repeat",
          })
        ).taskId,
      ).toBe(link.taskId);
      vi.setSystemTime(new Date("2027-11-19T12:00:00Z"));
      const nextAudit = await seasonalAudit("Segler", 2027);
      const nextWorkspace = await getProjectSeoWorkspace(seasonalActor, {});
      const nextAction = nextWorkspace.actions.find(
        (row) =>
          row.observationId === nextAudit.id && row.id.startsWith("seasonal:"),
      );
      expect(nextAction?.status).toBe("recommended");
      expect(nextAction!.id).not.toBe(action.id);
      const nextTask = await createProjectSeoActionTask(seasonalActor, {
        observationId: nextAudit.id,
        actionId: nextAction!.id,
        idempotencyKey: "next-season",
      });
      expect(nextTask.taskId).not.toBe(link.taskId);
    });

    it("stores the worker's plan with the audit and shows it on the audit's report", async () => {
      const project = await prisma.project.create({
        data: { workspaceId, name: "Audit plan" },
      });
      const owner: SeoActor = {
        ...actor,
        owner: { kind: "project", id: project.id },
      };
      const task = await prisma.task.create({
        data: {
          name: "Completed audit",
          ownerId: userId,
          workspaceId,
          projectId: project.id,
          status: "COMPLETED",
          assigneeId: coworkerId,
        },
      });
      const base = legacyReport();
      const step = {
        pageUrl: base.request.url,
        action: "Add a title",
        why: "The page has no title.",
        nextCheck: "The next audit reads a title.",
      };
      const body = JSON.stringify({
        ...base,
        recommendedPlan: {
          ...step,
          summary: "The audit found one issue.",
          links: [{ pageUrl: base.request.url, findings: ["finding"] }],
          // The second step is not readable: the plan ends before it, and the audit is still stored.
          nextSteps: [{ ...step, why: 7 }],
        },
      });
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
      const observation = await importProjectSeoAudit(
        owner,
        { taskId: task.id, fileId: file.id },
        { fetchImpl: async () => new Response(body) },
      );
      const workspace = await getProjectSeoWorkspace(owner);
      const plan = workspace.observations[0]?.auditPlan;
      expect(plan).toMatchObject({
        summary: "The audit found one issue.",
        steps: [{ action: "Add a title", actionIds: ["1"] }],
      });
      expect(
        workspace.actions.some(
          (row) => row.observationId === observation.id && row.id === "1",
        ),
      ).toBe(true);
    });

    it("recovers page speed once from the exact saved report without changing earlier conclusions", async () => {
      const project = await prisma.project.create({
        data: { workspaceId, name: "Page speed recovery" },
      });
      const owner: SeoActor = {
        ...actor,
        owner: { kind: "project", id: project.id },
      };
      const task = await prisma.task.create({
        data: {
          name: "Completed audit",
          ownerId: userId,
          workspaceId,
          projectId: project.id,
          status: "COMPLETED",
          assigneeId: coworkerId,
        },
      });
      const base = legacyReport();
      const body = JSON.stringify({
        ...base,
        speed: {
          mobile: {
            lab: {
              none: "Not checked: public worker excluded PageSpeed Insights",
            },
            field: {
              none: "Not checked: public worker excluded CrUX",
              failed: true,
            },
          },
        },
      });
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
      const input = { taskId: task.id, fileId: file.id },
        recover = { ...input, recoverPageSpeed: true as const };
      const fetchImpl = vi.fn(async () => new Response(body));
      const observation = await importProjectSeoAudit(owner, input, {
        fetchImpl,
      });
      const { pageSpeed, ...stored } = reportObject(observation.payload)!;
      expect(pageSpeed).toBeDefined();
      const old = { ...stored, retainedUnrecognizedField: "preserve" };
      await prisma.projectSeoObservation.update({
        where: { id: observation.id },
        data: { payload: jsonInput(old) },
      });
      expect(
        (await getProjectSeoWorkspace(owner)).observations[0]
          .pageSpeedRecoveryFileId,
      ).toBe(file.id);
      await expect(
        importProjectSeoAudit(owner, recover, {
          fetchImpl: async () => new Response(body + " "),
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        importProjectSeoAudit({ ...owner, userId: otherId }, recover, {
          fetchImpl,
        }),
      ).rejects.toMatchObject({ status: 404 });
      const result = await importProjectSeoAudit(owner, recover, { fetchImpl });
      expect(result.payload).toEqual({ ...old, pageSpeed });
      const count = fetchImpl.mock.calls.length;
      await importProjectSeoAudit(owner, recover, { fetchImpl });
      expect(fetchImpl).toHaveBeenCalledTimes(count);
      const latest = (await getProjectSeoWorkspace(owner)).observations[0];
      expect(latest.pageSpeed?.[0]).toMatchObject({
        lab: { status: "not_checked" },
        field: { status: "not_checked" },
      });
      expect(latest.pageSpeedRecoveryFileId).toBeUndefined();
    });

    it("stores a site audit's speed table and serves it on the workspace", async () => {
      const project = await prisma.project.create({
        data: { workspaceId, name: "Site speed table" },
      });
      const owner: SeoActor = {
        ...actor,
        owner: { kind: "project", id: project.id },
      };
      const task = await prisma.task.create({
        data: {
          name: "Completed site audit",
          ownerId: userId,
          workspaceId,
          projectId: project.id,
          status: "COMPLETED",
          assigneeId: coworkerId,
        },
      });
      const page = legacyReport();
      const extra = new URL("/pricing", page.request.url).href;
      const body = JSON.stringify({
        kind: "site",
        rulebookVersion: page.rulebookVersion,
        pages: [page],
        speed: {
          pages: [
            { url: page.request.url, n: 1, source: "audited", speed: null },
            // No tier, cause or check: Prisma must not get their undefined values.
            { url: extra, n: null, source: "search-console", speed: null },
            { url: "https://foreign.test/", n: null, source: "links" },
          ],
          note: null,
        },
      });
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
      const observation = await importProjectSeoAudit(
        owner,
        { taskId: task.id, fileId: file.id },
        { fetchImpl: async () => new Response(body) },
      );
      const rows = [
        { url: page.request.url, audited: true, devices: [] },
        { url: extra, audited: false, devices: [] },
      ];
      expect(reportObject(observation.payload)?.siteSpeed).toEqual({
        rows,
        dropped: 1,
      });
      expect((await getProjectSeoWorkspace(owner)).siteSpeed).toMatchObject({
        observationId: observation.id,
        rows,
        dropped: 1,
      });
    });

    it.each([true, false])(
      "recovers only saved site market fields on the exact existing observation (retained %s)",
      async (retained) => {
        const pageUrl = `https://market-recovery.test/${randomUUID()}`;
        const project = await prisma.project.create({
          data: { workspaceId, name: "Market recovery test" },
        });
        const owner: SeoActor = {
          ...actor,
          owner: { kind: "project", id: project.id },
        };
        const task = await prisma.task.create({
          data: {
            name: "Completed site audit",
            ownerId: userId,
            workspaceId,
            projectId: project.id,
            status: "COMPLETED",
            assigneeId: coworkerId,
          },
        });
        const base = siteStrategyReport();
        const page = legacyReport();
        const marketHost = {
          host: "market-recovery.test",
          role: "site",
          etv: 114,
          fetchedAt: "2026-10-01T00:00:00Z",
          note: null,
        };
        const markets = {
          rows: [
            {
              country: "FR",
              language: "fr",
              start: false,
              rivals: 1,
              of: 1,
              share: 0.5,
              etv: 90,
              ownShare: 0,
              hasLanguage: false,
              regionVersion: null,
              candidate: true,
            },
          ],
          hosts: [
            marketHost,
            {
              ...marketHost,
              role: "product",
              host: "direct-product.test",
              etv: 180,
            },
          ],
          outside: 0.5,
          siteVisits: true,
        };
        const body = JSON.stringify({
          ...base,
          pages: [{ ...page, request: { url: pageUrl } }],
          selection: { pages: [{ n: 1, url: pageUrl }] },
          strategy: {
            ...base.strategy,
            markets: retained ? markets : undefined,
          },
        });
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
        const input = { taskId: task.id, fileId: file.id };
        const recover = { ...input, recoverMarkets: true };
        const fetchImpl = vi.fn(async () => new Response(body));
        await expect(
          importProjectSeoAudit(owner, recover, { fetchImpl }),
        ).rejects.toMatchObject({ status: 404 });
        expect(fetchImpl).not.toHaveBeenCalled();
        const imported = await importProjectSeoAudit(owner, input, {
          fetchImpl,
        });
        const payload = reportObject(imported.payload)!;
        if (retained)
          expect(reportObject(payload.strategy)?.markets).toMatchObject({
            rows: markets.rows,
          });
        else
          expect(reportObject(payload.strategy)?.marketNote).toBe(
            "unavailable",
          );
        const {
          markets: _markets,
          marketNote: _note,
          ...storedStrategy
        } = reportObject(payload.strategy)!;
        const legacy = {
          ...payload,
          otherStoredField: "preserve",
          strategy: { ...storedStrategy, otherStoredStrategyField: "preserve" },
        };
        await prisma.projectSeoObservation.update({
          where: { id: imported.id },
          data: { payload: jsonInput(legacy) },
        });
        const before = await getProjectSeoWorkspace(owner);
        expect(before.strategy?.marketRecoveryFileId).toBe(file.id);
        await expect(
          importProjectSeoAudit(owner, recover, {
            fetchImpl: async () => new Response(body + " "),
          }),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          importProjectSeoAudit({ ...owner, userId: otherId }, recover, {
            fetchImpl,
          }),
        ).rejects.toMatchObject({ status: 404 });
        const [first, second] = await Promise.all([
          importProjectSeoAudit(owner, recover, { fetchImpl }),
          importProjectSeoAudit(owner, recover, { fetchImpl }),
        ]);
        expect(first.id).toBe(imported.id);
        expect(second).toEqual(first);
        const expectedFields = retained
          ? { markets: reportObject(payload.strategy)!.markets }
          : { marketNote: "unavailable" };
        expect(first).toEqual({
          ...imported,
          payload: {
            ...legacy,
            strategy: { ...legacy.strategy, ...expectedFields },
          },
        });
        const reads = fetchImpl.mock.calls.length;
        expect(
          await importProjectSeoAudit(owner, recover, { fetchImpl }),
        ).toEqual(first);
        expect(fetchImpl).toHaveBeenCalledTimes(reads);
        const after = await getProjectSeoWorkspace(owner);
        expect(after.strategy).toMatchObject(expectedFields);
        expect(after.strategy?.marketRecoveryFileId).toBeUndefined();
      },
    );

    it("imports only ready owned artifacts, rechecks source authority after fetch and links each action once", async () => {
      const edit = {
        target: "head > title",
        before: "<title></title>",
        after: "<title>Example page</title>",
      };
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
        const report = legacyReport();
        const body = JSON.stringify({
          ...report,
          strategyDecisions: [
            {
              id: "local-gap",
              kind: "content_opportunity",
              targetUrl: report.request.url,
              action: "Check the missing setup step",
              reason: "Three audited result pages describe setup.",
              alternative: "Link the existing getting started guide.",
              nextCheck: "Review the rendered steps after publishing.",
              evidence: ["public-heading-record"],
            },
          ],
          actions: report.actions.map((action) => ({ ...action, edit })),
        });
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
      const createdTask = await prisma.task.findUniqueOrThrow({
        where: { id: link.taskId },
      });
      expect(createdTask).toMatchObject({
        status: "DRAFT",
        projectId,
        ownerId: userId,
      });
      expect(createdTask.description).toContain(JSON.stringify(edit, null, 2));
      const workspace = await getProjectSeoWorkspace(actor, {});
      const decision = workspace.actions.find((a) => a.decision)!;
      const strategyTask = await createProjectSeoActionTask(actor, {
        observationId: decision.observationId,
        actionId: decision.id,
        idempotencyKey: "strategy-accept",
      });
      const strategyRow = await prisma.task.findUniqueOrThrow({
        where: { id: strategyTask.taskId },
      });
      for (const text of [
        decision.why,
        decision.decision!.nextCheck,
        decision.decision!.alternative,
        ...decision.evidence,
      ])
        expect(strategyRow.description).toContain(text);
      await prisma.task.update({
        where: { id: strategyTask.taskId },
        data: { visibility: "PRIVATE", ownerId: otherId },
      });
      expect(
        JSON.stringify(await getProjectSeoWorkspace(actor, {})),
      ).not.toContain(strategyTask.taskId);
      await expect(
        createProjectSeoActionTask(actor, {
          observationId: decision.observationId,
          actionId: decision.id,
          idempotencyKey: "strategy-accept",
        }),
      ).rejects.toMatchObject({ status: 404 });
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

    it("keeps old rankings reads in the position history past the bounded result list", async () => {
      const page = await addProjectSeoPage(actor, {
        url: "https://example.test/rank-history",
        relationship: "primary",
      });
      const older: { id: string }[] = [];
      for (const [day, position] of [
        [1, 9],
        [2, 7],
      ] as const)
        older.push(
          await storeResult(
            page.id,
            rankingsPayload(page.url, `2026-09-0${day}T09:00:00.000Z`, {
              position,
            }),
          ),
        );
      // Newer results the main list keeps first: it holds only the newest 100.
      const check = parsePublicSeoArtifact({
        ...focusedReport(),
        scope: { ...focusedReport().scope, pageUrls: [page.url] },
        checks: [],
      });
      await prisma.projectSeoObservation.createMany({
        data: Array.from({ length: 100 }, (_, index) => ({
          projectId,
          source: "seo_coworker",
          kind: "page_check",
          sourceKey: `rank-history-noise:${index}`,
          pageIds: [page.id],
          artifactHash: "rank-history-noise",
          payload: check,
          observedAt: new Date("2026-10-01T00:00:00Z"),
        })),
      });
      const newest = await storeResult(
        page.id,
        rankingsPayload(page.url, "2026-11-01T09:00:00.000Z", { position: 2 }),
      );
      const workspace = await getProjectSeoWorkspace(actor, {
        pageId: page.id,
      });
      expect(workspace.observations.some((row) => row.id === older[0].id)).toBe(
        false,
      );
      const row = workspace.keywords.find(
        (item) => item.observationId === newest.id,
      );
      expect(
        row?.positionHistory?.map((point) => [
          point.observationId,
          point.position,
        ]),
      ).toEqual([
        [older[0].id, 9],
        [older[1].id, 7],
        [newest.id, 2],
      ]);
    });

    it("reads the rank history only from rankings and audit_lite results", async () => {
      const page = await addProjectSeoPage(actor, {
        url: "https://example.test/rank-kinds",
        relationship: "primary",
      });
      const full = await storeResult(
        page.id,
        parsePublicSeoArtifact({
          ...legacyReport(),
          request: { url: page.url },
          header: {
            ...legacyReport().header,
            capturedAt: "2026-10-01T09:00:00.000Z",
          },
        }),
      );
      await storeResult(
        page.id,
        rankingsPayload(page.url, "2026-10-02T09:00:00.000Z", {
          kind: "page_check",
          position: 1,
        }),
      );
      const lite = await storeResult(
        page.id,
        rankingsPayload(page.url, "2026-10-03T09:00:00.000Z", {
          kind: "audit_lite",
          position: 6,
        }),
      );
      const rankings = await storeResult(
        page.id,
        rankingsPayload(page.url, "2026-10-04T09:00:00.000Z", { position: 4 }),
      );
      const workspace = await getProjectSeoWorkspace(actor, {
        pageId: page.id,
      });
      const read = workspace.keywords.find(
        (item) => item.observationId === rankings.id,
      );
      expect(
        read?.positionHistory?.map((point) => point.observationId),
      ).toEqual([lite.id, rankings.id]);
      // The full audit's own keyword rows exist, without a history.
      const fullRows = workspace.keywords.filter(
        (item) => item.observationId === full.id,
      );
      expect(fullRows.length).toBeGreaterThan(0);
      expect(fullRows.map((item) => item.positionHistory)).toEqual(
        fullRows.map(() => undefined),
      );
      expect(
        workspace.serpHistory?.flatMap((series) =>
          series.points.map((point) => point.observationId),
        ),
      ).toEqual([lite.id, rankings.id]);
    });

    it("keeps private results and results of unselected pages out of the SERP history and share of voice", async () => {
      const page = await addProjectSeoPage(actor, {
        url: "https://example.test/rank-scope",
        relationship: "primary",
      });
      const other = await addProjectSeoPage(actor, {
        url: "https://example.test/rank-scope-other",
        relationship: "primary",
      });
      const at = "2026-10-05T09:00:00.000Z";
      await storeResult(page.id, rankingsPayload(page.url, at));
      await storeResult(
        other.id,
        rankingsPayload(other.url, at, { serpKeyword: "unselected page" }),
      );
      await storeResult(
        page.id,
        rankingsPayload(page.url, at, { serpKeyword: "private result" }),
        { ownerId: userId },
      );
      const workspace = await getProjectSeoWorkspace(actor, {
        pageId: page.id,
      });
      expect(workspace.serpHistory?.map((series) => series.keyword)).toEqual([
        "example",
      ]);
      expect(workspace.shareOfVoice?.weeks.map((week) => week.reads)).toEqual([
        1,
      ]);
    });

    it("imports valid rankings evidence alongside malformed difficulty and SERP reads", async () => {
      const page = await addProjectSeoPage(actor, {
        url: "https://example.test/rank-import",
        relationship: "primary",
      });
      const base = focusedRankingsReport();
      // One rankings Analysis per report: a Task holds one report file.
      const upload = async (idempotencyKey: string, serps: unknown[]) => {
        const analysis = await requestProjectSeoAnalysis(
          actor,
          requestSeoAnalysisSchema.parse({
            kind: "rankings",
            pageIds: [page.id],
            keywords: ["example"],
            countryCode: "US",
            languageCode: "en",
            devices: ["desktop"],
            idempotencyKey,
            coworkerId,
          }),
        );
        const taskId = analysis.taskId;
        if (!taskId) throw new Error("The Analysis did not create a Task");
        await prisma.task.update({
          where: { id: taskId },
          data: { status: "COMPLETED" },
        });
        const body = JSON.stringify({
          ...base,
          requestId: analysis.id,
          scope: { ...base.scope, pageUrls: [page.url] },
          keywords: [
            { ...base.keywords[0], pageUrl: page.url, difficulty: 140 },
          ],
          serps,
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
        return {
          input: { taskId, fileId: file.id },
          fetchImpl: (async () => new Response(body)) as typeof fetch,
        };
      };
      const unrequested = await upload("rankings-serp-unrequested", [
        serpRead({ keyword: "unrequested" }),
      ]);
      await expect(
        importProjectSeoAudit(actor, unrequested.input, {
          fetchImpl: unrequested.fetchImpl,
        }),
      ).rejects.toMatchObject({ status: 400 });
      const partial = await upload("rankings-serp-partial", [
        serpRead(),
        { keyword: 5 },
      ]);
      const imported = await importProjectSeoAudit(actor, partial.input, {
        fetchImpl: partial.fetchImpl,
      });
      const stored = await prisma.projectSeoObservation.findUniqueOrThrow({
        where: { id: imported.id },
      });
      const payload = stored.payload as {
        keywords: Array<{ keyword: string }>;
        serps?: unknown[];
        notes: string[];
      };
      expect(payload.keywords).toHaveLength(1);
      expect(payload.keywords[0]?.keyword).toBe("example");
      expect(payload.keywords[0]).not.toHaveProperty("difficulty");
      expect(payload.serps).toHaveLength(1);
      expect(payload.notes).toContain(SEO_SERPS_NOT_READ);
      expect(
        await prisma.projectSeoObservation.count({
          where: { sourceFileId: unrequested.input.fileId },
        }),
      ).toBe(0);
      const workspace = await getProjectSeoWorkspace(actor, {
        pageId: page.id,
      });
      expect(
        workspace.serpHistory?.map((series) => [
          series.keyword,
          series.pageUrls,
          series.points.map((point) => point.pages),
        ]),
      ).toEqual([["example", [page.url], [[0]]]]);
      expect(workspace.shareOfVoice?.weeks).toHaveLength(1);
    });

    it("counts only the confirmed competitors of its own project in share of voice", async () => {
      const ownProjectId = randomUUID();
      await prisma.project.create({
        data: { id: ownProjectId, workspaceId, name: "SEO share test" },
      });
      const own: SeoActor = {
        ...actor,
        owner: { kind: "project", id: ownProjectId },
      };
      const page = await addProjectSeoPage(own, {
        url: "https://example.test/share",
        relationship: "primary",
      });
      await prisma.projectSeoCompetitor.createMany({
        data: [
          {
            projectId: ownProjectId,
            url: "https://rival-own.test/",
            confirmed: true,
          },
          {
            projectId: ownProjectId,
            url: "https://rival-unconfirmed.test/",
            confirmed: false,
          },
          { projectId, url: "https://rival-other.test/", confirmed: true },
        ],
      });
      await prisma.projectSeoObservation.create({
        data: {
          projectId: ownProjectId,
          source: "seo_coworker",
          kind: "rankings",
          sourceKey: randomUUID(),
          pageIds: [page.id],
          artifactHash: "share-of-voice",
          payload: rankingsPayload(page.url, "2026-10-06T09:00:00.000Z", {
            top: [
              { rank: 1, domain: "rival-own.test" },
              { rank: 2, domain: "example.test" },
              { rank: 3, domain: "rival-other.test" },
              { rank: 4, domain: "rival-unconfirmed.test" },
            ],
          }),
          observedAt: new Date("2026-10-06T09:00:00.000Z"),
        },
      });
      const week = (await getProjectSeoWorkspace(own, { pageId: page.id }))
        .shareOfVoice?.weeks[0];
      expect(week?.competitors.map((row) => row.domain)).toEqual([
        "rival-own.test",
      ]);
      expect(week?.site).toBeGreaterThan(0);
      expect(week?.others).toBeGreaterThan(0);
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

/** A rankings-shaped result of one page: one desktop position read and one SERP read of "example". */
function rankingsPayload(
  pageUrl: string,
  observedAt: string,
  options: {
    kind?: string;
    position?: number;
    serpKeyword?: string;
    top?: { rank: number; domain: string }[];
  } = {},
) {
  const base = focusedRankingsReport();
  return parsePublicSeoArtifact({
    ...base,
    kind: options.kind ?? base.kind,
    observedAt,
    scope: { ...base.scope, pageUrls: [pageUrl] },
    keywords: [
      {
        ...base.keywords[0],
        pageUrl,
        observedAt,
        position: options.position ?? base.keywords[0].position,
      },
    ],
    serps: [
      serpRead({
        observedAt,
        keyword: options.serpKeyword ?? "example",
        ...(options.top ? { top: options.top } : {}),
      }),
    ],
  });
}

/** Stores a public result of the test project for one page. */
function storeResult(
  pageId: string,
  payload: ReturnType<typeof parsePublicSeoArtifact>,
  extra: { ownerId?: string } = {},
) {
  return prisma.projectSeoObservation.create({
    data: {
      projectId,
      source: "seo_coworker",
      kind: payload.kind,
      sourceKey: randomUUID(),
      pageIds: [pageId],
      artifactHash: "rank-history",
      payload,
      observedAt: new Date(payload.observedAt),
      ...extra,
    },
  });
}
