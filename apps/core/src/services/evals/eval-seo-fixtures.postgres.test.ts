import { randomUUID } from "node:crypto";
import {
  SEO_EVAL_CAPABILITIES,
  SOKO_BOT_SCENARIOS,
  type SokoBotSeoCapability,
} from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { runSeoTool } from "@/lib/soko-bot/seo-tools";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { type EvalLaneRecord, ensureEvalLanes } from "./eval-lanes.service";
import { seoEvalChecks } from "./eval-seo-checks";
import {
  assertSeoEvalCapability,
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
let lane: EvalLaneRecord;

async function prepare(caseId: string) {
  const scenario = SOKO_BOT_SCENARIOS.find((entry) => entry.id === caseId);
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

function actor(fixture: SeoEvalFixture): SeoActor {
  return {
    owner: { kind: "project", id: fixture.projectId },
    userId: lane.userId,
    workspaceId: lane.workspaceId,
    organizationId: lane.organizationId,
    sokoBotId: lane.sokoBotId,
    privateMetricsAllowed: true,
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

async function turn(resultId: string, clientTurnId = `lab:eval:${resultId}`) {
  const created = await prisma.sokoBotTurn.create({
    data: {
      sokoBotId: lane.sokoBotId,
      workspaceId: lane.workspaceId,
      source: "CHAT",
      requestedByUserId: lane.userId,
      clientTurnId,
      userMessage: "SEO fixture test",
      capabilityNames: [],
      deadlineAt: new Date(Date.now() + 60_000),
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
        where: { id: { in: links.map((link) => link.taskId) } },
      });
      await prisma.projectSeoActionTask.deleteMany({
        where: { observationId: { in: resultIds } },
      });
      await prisma.projectSeoObservation.deleteMany({
        where: { id: { in: resultIds } },
      });
      await prisma.sokoBotTurn.deleteMany({ where: { id: { in: turnIds } } });
      await prisma.evalRun.deleteMany({ where: { id: { in: runIds } } });
      await prisma.$disconnect();
    });

    it.each(Object.entries(SEO_EVAL_CAPABILITIES))(
      "%s requires a real scoped result from %s",
      async (caseId, capability) => {
        const prepared = await prepare(caseId);
        const toolCalls: {
          capability: string;
          status: string;
          input: unknown;
          result: unknown;
        }[] = [];
        const before = await seoEvalChecks(
          caseId,
          lane,
          { toolCalls },
          prepared.state,
        );
        expect(before.some((check) => !check.pass)).toBe(true);
        const call = async (name: SokoBotSeoCapability, input: unknown) => {
          const result = await runSeoTool(
            name,
            input,
            actor(prepared.fixture),
            {},
          );
          toolCalls.push({
            capability: name,
            status: "COMPLETED",
            input,
            result,
          });
          return result;
        };
        if (
          capability !== "get_seo_workspace" &&
          capability !== "list_seo_statistics_properties"
        )
          await call("get_seo_workspace", {
            projectId: prepared.fixture.projectId,
          });
        await call(capability, mutationInput(caseId, prepared.fixture));
        const checks = await seoEvalChecks(
          caseId,
          lane,
          { toolCalls },
          prepared.state,
        );
        expect(checks.filter((check) => !check.pass)).toEqual([]);
        const retry = await prepareSeoEvalCase(
          lane,
          prepared.scenario,
          prepared.resultId,
        );
        expect(retry.state).toEqual(prepared.state);
        expect(
          (await seoEvalChecks(caseId, lane, { toolCalls }, retry.state)).every(
            (check) => check.pass,
          ),
        ).toBe(true);
      },
    );

    it("does not accept a successful tool name with no stored effect or a forged lane", async () => {
      const prepared = await prepare("seo-save-keyword");
      const toolCalls = [
        {
          capability: "save_seo_keyword",
          status: "COMPLETED",
          input: mutationInput("seo-save-keyword", prepared.fixture),
          result: { result: { id: randomUUID() } },
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

    it("blocks every external SEO boundary for prepared, damaged, and missing eval bindings", async () => {
      const prepared = await prepare("seo-workspace-read");
      const turnId = await turn(prepared.resultId);
      for (const capability of [
        "import_seo_audit",
        "request_seo_analysis",
        "sync_seo_statistics",
      ]) {
        await expect(
          assertSeoEvalCapability(turnId, capability),
        ).rejects.toMatchObject({ status: 400 });
        await prisma.evalResult.update({
          where: { id: prepared.resultId },
          data: { state: { seoFixture: "invalid" } },
        });
        await expect(
          assertSeoEvalCapability(turnId, capability),
        ).rejects.toMatchObject({ status: 400 });
      }
      await prisma.evalResult.delete({ where: { id: prepared.resultId } });
      await expect(
        assertSeoEvalCapability(turnId, "request_seo_analysis"),
      ).rejects.toMatchObject({ status: 400 });
      const normal = await turn(randomUUID(), `owner:${randomUUID()}`);
      await expect(
        assertSeoEvalCapability(normal, "request_seo_analysis"),
      ).resolves.toBeUndefined();
      const research = await prisma.evalResult.create({
        data: {
          runId: runIds[0]!,
          caseId: "web-research-with-sources",
          suite: "soko-bot",
          repeat: lane.lane,
          position: 1,
        },
      });
      const researchTurn = await turn(research.id);
      for (const capability of [
        "import_seo_audit",
        "request_seo_analysis",
        "sync_seo_statistics",
      ])
        await expect(
          assertSeoEvalCapability(researchTurn, capability),
        ).rejects.toMatchObject({ status: 400 });
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
