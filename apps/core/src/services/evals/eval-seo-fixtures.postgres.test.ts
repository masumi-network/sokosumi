import { randomUUID } from "node:crypto";
import {
  SEO_EVAL_CAPABILITIES,
  SEO_SCENARIOS,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { runSeoTool } from "@/lib/soko-bot/seo-tools";
import { loadLabScenarioTurn } from "@/services/soko-bot-lab-scenario.service";
import { SokoBotRuntimeService } from "@/services/soko-bot-runtime.service";
import { startEvalCase } from "./eval-case-runner";
import { EVAL_CASES } from "./eval-cases";
import { type EvalLaneRecord, ensureEvalLanes } from "./eval-lanes.service";
import { seoEvalChecks } from "./eval-seo-checks";
import {
  prepareSeoEvalCase,
  SEO_EVAL_EXPECTED,
  type SeoEvalFixture,
} from "./eval-seo-fixtures";

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

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const resultIds: string[] = [];
const runIds: string[] = [];
const turnIds: string[] = [];
const unrelatedTaskIds: string[] = [];
const unrelatedKeywordIds: string[] = [];
const TEST_TURN_LEASE_MS = 60_000;
let lane: EvalLaneRecord;

async function prepare(caseId: string) {
  const scenario = SEO_SCENARIOS.find((entry) => entry.id === caseId);
  if (!scenario) throw new Error(`Missing scenario ${caseId}`);
  const run = await prisma.evalRun.create({
    data: {
      trigger: "MANUAL",
      status: "RUNNING",
      suites: ["soko-bot"],
      repeats: 1,
      environment: "local",
    },
  });
  runIds.push(run.id);
  const result = await prisma.evalResult.create({
    data: {
      runId: run.id,
      caseId,
      suite: "soko-bot",
      repeat: lane.lane,
      position: 0,
    },
  });
  resultIds.push(result.id);
  const prepared = await prepareSeoEvalCase(lane, scenario, result.id);
  return {
    ...prepared,
    resultId: result.id,
    fixture: prepared.state.seoFixture as SeoEvalFixture,
  };
}

function mutationInput(caseId: string, fixture: SeoEvalFixture) {
  const expected = SEO_EVAL_EXPECTED;
  const base = { projectId: fixture.projectId };
  switch (caseId) {
    case "seo-workspace-read":
      return base;
    case "seo-add-page":
      return {
        ...base,
        url: expected.addedPageUrl,
        label: expected.addedPageLabel,
        relationship: "related",
        relatedToPageId: fixture.homePageId,
      };
    case "seo-save-page-group":
      return {
        ...base,
        name: expected.groupName,
        pageIds: [fixture.homePageId, fixture.pricingPageId],
      };
    case "seo-save-keyword":
      return {
        ...base,
        keyword: expected.keyword,
        countryCode: "US",
        languageCode: "en",
        priority: "high",
        saved: true,
        pageId: fixture.pricingPageId,
      };
    case "seo-confirm-competitor":
      return { ...base, url: expected.competitorUrl, confirmed: true };
    case "seo-recommendation-task":
      return {
        ...base,
        observationId: fixture.resultId,
        actionId: expected.actionId,
        idempotencyKey: fixture.resultId,
      };
    case "seo-record-page-change":
      return {
        ...base,
        pageIds: [fixture.pricingPageId],
        occurredAt: fixture.occurredAt,
        title: expected.changeTitle,
        note: expected.changeNote,
        idempotencyKey: fixture.resultId,
      };
    case "seo-statistics-disconnected":
      return { ...base, provider: "search_console" };
    default:
      throw new Error("Unknown SEO case");
  }
}

async function turn(
  resultId: string,
  clientTurnId = `lab:eval:${resultId}`,
  capabilities: SokoBotCapability[] = [],
) {
  const created = await prisma.sokoBotTurn.create({
    data: {
      sokoBotId: lane.sokoBotId,
      workspaceId: lane.workspaceId,
      source: "CHAT",
      requestedByUserId: lane.userId,
      clientTurnId,
      userMessage: "SEO fixture test",
      capabilityNames: capabilities,
      versionId: "v33",
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + TEST_TURN_LEASE_MS),
      leaseExpiresAt: new Date(Date.now() + TEST_TURN_LEASE_MS),
      contextSnapshot: {
        create: {
          generatedAt: new Date(),
          schemaVersion: 1,
          hash: "seo-eval-persisted-regression",
          packet: { memory: { version: 0 } },
          byteSize: 0,
          tokenEstimate: 0,
          counts: {},
          omissions: {},
        },
      },
    },
  });
  turnIds.push(created.id);
  return created.id;
}

describe.skipIf(!enabled)(
  "provider-free SEO model-case fixtures with PostgreSQL",
  () => {
    beforeAll(async () => {
      const lanes = await ensureEvalLanes(1);
      if (!lanes[0]) throw new Error("Missing registered eval lane");
      lane = lanes[0];
    });
    afterAll(async () => {
      const links = await prisma.projectSeoActionTask.findMany({
        where: { observationId: { in: resultIds } },
        select: { taskId: true },
      });
      await prisma.task.deleteMany({
        where: {
          id: {
            in: [...links.map((link) => link.taskId), ...unrelatedTaskIds],
          },
        },
      });
      await prisma.projectSeoActionTask.deleteMany({
        where: { observationId: { in: resultIds } },
      });
      await prisma.projectSeoObservation.deleteMany({
        where: { id: { in: resultIds } },
      });
      await prisma.projectSeoKeyword.deleteMany({
        where: { id: { in: unrelatedKeywordIds } },
      });
      await prisma.sokoBotTurn.deleteMany({ where: { id: { in: turnIds } } });
      await prisma.evalRun.deleteMany({ where: { id: { in: runIds } } });
      await prisma.$disconnect();
    });

    it("resumes an existing SEO turn without resetting its persisted fixture", async () => {
      const prepared = await prepare("seo-save-keyword");
      const turnId = await turn(prepared.resultId);
      const evalCase = EVAL_CASES.find(
        (entry) => entry.id === "seo-save-keyword",
      );
      if (!evalCase) throw new Error("Missing SEO case");
      const input = mutationInput("seo-save-keyword", prepared.fixture);
      const actor = {
        userId: lane.userId,
        workspaceId: lane.workspaceId,
        organizationId: lane.organizationId,
        sokoBotId: lane.sokoBotId,
        owner: { kind: "project" as const, id: prepared.fixture.projectId },
      };
      await runSeoTool("save_seo_keyword", input, actor, {});
      const restarted = await startEvalCase(evalCase, lane, {
        resultId: prepared.resultId,
        firstOfSuite: true,
        startedAt: new Date(),
      });
      expect(restarted).toEqual({
        kind: "started",
        turnId,
        state: prepared.state,
      });
      expect(
        await prisma.projectSeoKeyword.findFirst({
          where: {
            projectId: prepared.fixture.projectId,
            keywordKey: SEO_EVAL_EXPECTED.keyword,
            countryCode: "US",
            languageCode: "en",
          },
        }),
      ).not.toBeNull();
      expect(
        await prisma.sokoBotTurn.count({
          where: {
            sokoBotId: lane.sokoBotId,
            clientTurnId: `lab:eval:${prepared.resultId}`,
          },
        }),
      ).toBe(1);
    });

    it.each(Object.entries(SEO_EVAL_CAPABILITIES))(
      "%s requires a real scoped result from %s",
      async (caseId, capability) => {
        const prepared = await prepare(caseId);
        const service = new SokoBotRuntimeService();
        const turnId = await turn(prepared.resultId, undefined, [
          "get_seo_workspace",
          capability,
          "get_task_status",
          "save_seo_keyword",
        ]);
        const request = { turnId, sessionId: `seo-eval-${turnId}` };
        const before = await seoEvalChecks(
          caseId,
          lane,
          await loadLabScenarioTurn(turnId),
          prepared.state,
        );
        expect(before.some((check) => !check.pass)).toBe(true);
        const call = (name: SokoBotCapability, input: unknown) =>
          service.executeTool({
            ...request,
            capability: name,
            toolCallId: randomUUID(),
            input,
          });
        if (
          capability !== "get_seo_workspace" &&
          capability !== "list_seo_statistics_properties"
        )
          await call("get_seo_workspace", {
            projectId: prepared.fixture.projectId,
          });
        await call(capability, mutationInput(caseId, prepared.fixture));
        if (caseId === "seo-recommendation-task") {
          const link = await prisma.projectSeoActionTask.findFirstOrThrow({
            where: {
              observationId: prepared.fixture.resultId,
              projectId: prepared.fixture.projectId,
            },
          });
          await call("get_task_status", { taskId: link.taskId });
        }
        const stored = await loadLabScenarioTurn(turnId);
        const checks = await seoEvalChecks(
          caseId,
          lane,
          stored,
          prepared.state,
        );
        expect(checks.filter((check) => !check.pass)).toEqual([]);
        if (
          capability !== "get_seo_workspace" &&
          capability !== "list_seo_statistics_properties"
        ) {
          const effect = stored.toolCalls.find(
            (entry) => entry.capability === capability,
          );
          expect(effect).toMatchObject({
            status: "COMPLETED",
            result: {
              id: expect.any(String),
              projectId: prepared.fixture.projectId,
            },
          });
          expect(effect?.result).not.toHaveProperty("result");
          const forgedProject = {
            ...stored,
            toolCalls: stored.toolCalls.map((entry) =>
              entry === effect
                ? {
                    ...entry,
                    result: {
                      ...(entry.result as object),
                      projectId: randomUUID(),
                    },
                  }
                : entry,
            ),
          };
          expect(
            (
              await seoEvalChecks(caseId, lane, forgedProject, prepared.state)
            ).find(
              (check) =>
                check.label ===
                "One real scoped SEO effect matches the request",
            )?.pass,
          ).toBe(false);
        }
        const retry = await prepareSeoEvalCase(
          lane,
          prepared.scenario,
          prepared.resultId,
        );
        expect(retry.state).toEqual(prepared.state);
        expect(
          (await seoEvalChecks(caseId, lane, stored, retry.state)).every(
            (check) => check.pass,
          ),
        ).toBe(true);
        if (caseId === "seo-recommendation-task") {
          const unrelated = await prisma.task.create({
            data: {
              name: "Unrelated fixture draft",
              workspaceId: lane.workspaceId,
              projectId: prepared.fixture.projectId,
              ownerId: lane.userId,
              creatorUserId: lane.userId,
            },
          });
          unrelatedTaskIds.push(unrelated.id);
          await call("get_task_status", { taskId: unrelated.id });
          const withUnrelatedRead = await seoEvalChecks(
            caseId,
            lane,
            await loadLabScenarioTurn(turnId),
            prepared.state,
          );
          expect(withUnrelatedRead.filter((check) => !check.pass)).toEqual([
            expect.objectContaining({
              label: "Only the requested SEO operation and safe reads",
              actual: "get_task_status",
            }),
          ]);
          await call("save_seo_keyword", {
            ...mutationInput("seo-save-keyword", prepared.fixture),
            keyword: `unrelated fixture ${prepared.resultId}`,
          });
          const withMutation = await loadLabScenarioTurn(turnId);
          const unrelatedKeyword = withMutation.toolCalls.find(
            (entry) => entry.capability === "save_seo_keyword",
          );
          expect(unrelatedKeyword).toMatchObject({
            status: "COMPLETED",
            result: { id: expect.any(String) },
          });
          unrelatedKeywordIds.push(
            (unrelatedKeyword?.result as { id: string }).id,
          );
          expect(
            (
              await seoEvalChecks(caseId, lane, withMutation, prepared.state)
            ).filter((check) => !check.pass),
          ).toEqual([
            expect.objectContaining({
              label: "Only the requested SEO operation and safe reads",
              actual: "get_task_status, save_seo_keyword",
            }),
          ]);
        }
      },
    );

    it("does not accept a successful tool name with no stored effect or a forged lane", async () => {
      const prepared = await prepare("seo-save-keyword");
      const toolCalls = [
        {
          capability: "save_seo_keyword",
          status: "COMPLETED",
          input: mutationInput("seo-save-keyword", prepared.fixture),
          result: { id: randomUUID(), projectId: prepared.fixture.projectId },
        },
      ];
      expect(
        (
          await seoEvalChecks(
            "seo-save-keyword",
            lane,
            { toolCalls },
            prepared.state,
          )
        ).some((check) => !check.pass),
      ).toBe(true);
      const forged = { ...lane, workspaceId: randomUUID() };
      expect(
        (
          await seoEvalChecks(
            "seo-save-keyword",
            forged,
            { toolCalls },
            prepared.state,
          )
        ).some((check) => !check.pass),
      ).toBe(true);
      await expect(
        prepareSeoEvalCase(forged, prepared.scenario, prepared.resultId),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("blocks all paid SEO tools in the registered bot workspace even after fixture bindings disappear", async () => {
      const prepared = await prepare("seo-workspace-read");
      const actor = {
        userId: lane.userId,
        workspaceId: lane.workspaceId,
        organizationId: lane.organizationId,
        sokoBotId: lane.sokoBotId,
        owner: { kind: "project" as const, id: lane.world.marketingProjectId },
      };
      const base = { projectId: actor.owner.id };
      const attempts = [
        {
          capability: "import_seo_audit" as const,
          input: { ...base, taskId: randomUUID(), fileId: randomUUID() },
        },
        {
          capability: "request_seo_analysis" as const,
          input: {
            ...base,
            kind: "page_check",
            countryCode: "US",
            languageCode: "en",
            pageIds: [prepared.fixture.homePageId],
            idempotencyKey: `guard:${randomUUID()}`,
          },
        },
        {
          capability: "sync_seo_statistics" as const,
          input: {
            ...base,
            provider: "ga4",
            propertyId: "properties/123",
            pageIds: [prepared.fixture.homePageId],
            from: "2026-01-01",
            to: "2026-01-02",
          },
        },
      ];
      for (const attempt of attempts) {
        await expect(
          runSeoTool(attempt.capability, attempt.input, actor, {}),
        ).rejects.toMatchObject({
          status: 400,
          message:
            "Provider-backed SEO tools are not available in provider-free eval cases",
        });
      }
      await prisma.evalResult.update({
        where: { id: prepared.resultId },
        data: { state: { seoFixture: "invalid" } },
      });
      for (const attempt of attempts)
        await expect(
          runSeoTool(attempt.capability, attempt.input, actor, {}),
        ).rejects.toMatchObject({ status: 400 });
      await prisma.evalResult.delete({ where: { id: prepared.resultId } });
      for (const attempt of attempts)
        await expect(
          runSeoTool(attempt.capability, attempt.input, actor, {}),
        ).rejects.toMatchObject({ status: 400 });
      expect(
        await runSeoTool("get_seo_workspace", base, actor, {}),
      ).toHaveProperty("pages");
    });

    it("refuses a damaged prepared state instead of resetting records after a retry", async () => {
      const prepared = await prepare("seo-add-page");
      await prisma.evalResult.update({
        where: { id: prepared.resultId },
        data: { state: { seoFixture: "invalid" } },
      });
      await expect(
        prepareSeoEvalCase(lane, prepared.scenario, prepared.resultId),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("refuses a lane with a native statistics connection before any provider tool can run", async () => {
      const prepared = await prepare("seo-statistics-disconnected");
      const connection = await prisma.seoConnection.create({
        data: {
          workspaceId: lane.workspaceId,
          userId: lane.userId,
          provider: "search_console",
          status: "ACTIVE",
        },
      });
      try {
        await expect(
          prepareSeoEvalCase(lane, prepared.scenario, prepared.resultId),
        ).rejects.toMatchObject({ status: 400 });
      } finally {
        await prisma.seoConnection.delete({ where: { id: connection.id } });
      }
    });

    it("does not prepare fixtures after a run stops or in another Project", async () => {
      const prepared = await prepare("seo-add-page");
      await prisma.evalRun.updateMany({
        where: { results: { some: { id: prepared.resultId } } },
        data: { status: "CANCELLED" },
      });
      await expect(
        prepareSeoEvalCase(lane, prepared.scenario, prepared.resultId),
      ).rejects.toMatchObject({ status: 400 });
      const foreign = {
        ...lane,
        world: {
          ...lane.world,
          marketingProjectId: lane.world.outreachProjectId,
        },
      };
      await expect(
        prepareSeoEvalCase(foreign, prepared.scenario, prepared.resultId),
      ).rejects.toMatchObject({ status: 400 });
    });
  },
);
