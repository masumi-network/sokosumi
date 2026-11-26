import { randomUUID } from "node:crypto";
import { Prisma } from "@sokosumi/database";
import { CMO_PRODUCTION_TURN_PREFIX } from "@sokosumi/soko-bot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import { STRATEGY_TURN_PREFIX } from "@/services/marketing-strategy.service";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import {
  registerWatch,
  syncSokoBotWatches,
  watchOriginTurnId,
} from "@/services/soko-bot-watches.service";
import type { EvalLaneRecord } from "./eval-lanes.service";

// Core's real watch registration and wake; only the model turn is a stand-in.
vi.mock("@/services/cmo-production.service", async (original) => ({
  ...(await original<object>()),
  advanceCmoProduction: async () => ({ state: "stuck", ready: 0, total: 1 }),
}));
vi.mock("@/services/cmo-cuso.service", async (original) => ({
  ...(await original<object>()),
  findCusoForBot: async (id: string) => ({ id, sokoBotId: id }),
}));
const { judge, laneRef } = vi.hoisted(() => ({
  judge: vi.fn().mockResolvedValue({
    scores: { delegation: 5, followThrough: 5, judgment: 5, honesty: 5 },
    verdict: "pass",
    rationale: "Fixture judgment.",
    issues: [],
  }),
  laneRef: { current: {} as EvalLaneRecord },
}));
vi.mock("@/lib/soko-bot/claude-code-judge", () => ({
  runClaudeCodeJudge: judge,
}));
vi.mock("@/config/env", async (original) => {
  const env = await original<typeof import("@/config/env")>();
  return {
    ...env,
    getEnv: () => ({
      ...env.getEnv(),
      SOKO_BOT_JUDGE_RUNNER: "claude-code",
      SOKO_BOT_JUDGE_CLAUDE_CODE_MODEL: "offline",
      VERCEL_ENV: undefined,
    }),
  };
});
vi.mock("ai", async (original) => ({
  ...(await original<object>()),
  generateText: vi.fn(() => {
    throw new Error("No model use in the fixture");
  }),
}));
vi.mock("./eval-lanes.service", async (original) => ({
  ...(await original<object>()),
  getEvalLane: async () => laneRef.current,
  pauseEvalLanes: async () => {},
}));

import { evalCase } from "./eval-cases";
import { CMO_EVAL_CASES } from "./eval-cmo-cases";
import { tickEvalRuns } from "./eval-runs.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const LOST = {
  kind: "event",
  jev: { ms: 45_000, asked: 4, failed: "TimeoutError" },
};
const HEALTHY = { kind: "chat", jev: { ms: 4_600, asked: 4 } };

/** One RUNNING result, moved on by the real eval tick, as stored. */
async function stored(
  caseId: string,
  lane: EvalLaneRecord,
  turnId: string | null,
  state: Record<string, unknown> | null,
  startedAt = new Date(Date.now() - 60_000),
) {
  laneRef.current = lane;
  const run = await prisma.evalRun.create({
    data: {
      trigger: "MANUAL",
      status: "RUNNING",
      suites: ["cmo"],
      caseIds: [caseId],
      environment: "local",
      repeats: 1,
      startedAt,
    },
  });
  try {
    const row = await prisma.evalResult.create({
      data: {
        runId: run.id,
        caseId,
        suite: "cmo",
        repeat: 1,
        position: 0,
        status: "RUNNING",
        turnId,
        state: state ? jsonInput(state) : Prisma.DbNull,
        startedAt,
      },
    });
    await tickEvalRuns(() => false);
    return await prisma.evalResult.findUniqueOrThrow({ where: { id: row.id } });
  } finally {
    await prisma.evalRun.delete({ where: { id: run.id } });
  }
}

async function snap(turnId: string, organizer: object) {
  const packet = jsonInput({ workspace: { marketing: { organizer } } });
  await prisma.sokoBotContextSnapshot.upsert({
    where: { turnId },
    update: { packet },
    create: {
      turnId,
      generatedAt: new Date(),
      schemaVersion: 1,
      hash: randomUUID(),
      packet,
      byteSize: 1,
      tokenEstimate: 1,
      counts: {},
      omissions: [],
    },
  });
}

describe.skipIf(!enabled)("plan cases whose context pick was lost", () => {
  const owners: string[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const id of owners.splice(0)) {
      await prisma.sokoBotTurn.deleteMany({ where: { workspaceId: id } });
      await prisma.marketingStrategy.deleteMany({
        where: { project: { workspaceId: id } },
      });
      await prisma.sokoBot.deleteMany({ where: { workspaceId: id } });
      await prisma.project.deleteMany({ where: { workspaceId: id } });
      await prisma.user.deleteMany({ where: { id } });
    }
  });

  async function owner() {
    const id = randomUUID();
    owners.push(id);
    await prisma.user.create({
      data: {
        id,
        name: "Fixture",
        email: `${id}@example.test`,
        emailVerified: true,
        updatedAt: new Date(),
        createdAt: new Date(),
        workspace: { create: { id } },
      },
    });
    return id;
  }

  it("never grades a scenario turn or its run whose pick was lost", async () => {
    const id = await owner();
    const sokoBotId = randomUUID();
    await prisma.sokoBot.create({
      data: { id: sokoBotId, userId: id, workspaceId: id },
    });
    const lane = {
      userId: id,
      workspaceId: id,
      cusoBotId: sokoBotId,
      lane: 1,
    } as EvalLaneRecord;
    const scenario = evalCase("cmo-thanks-reads-nothing")!;
    const root = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId,
        workspaceId: id,
        requestedByUserId: id,
        source: "CHAT",
        status: "COMPLETED",
        versionId: "cmo-v24",
        route: "DIRECT_RESPONSE",
        clientTurnId: randomUUID(),
        userMessage: "Thanks.",
        finalAnswer: "You're welcome.",
        capabilityNames: [],
        deadlineAt: new Date(),
      },
    });
    const poll = () => stored(scenario.id, lane, root.id, null);
    // Scored by its checks and the judge: what verdict is the fixture's.
    const scored = async () => {
      const result = await poll();
      expect(["PASSED", "FAILED"]).toContain(result.status);
      expect(result.output).not.toHaveProperty("infrastructure");
    };
    vi.stubEnv("SOKO_BOT_LOCAL_CHATGPT_PLAN", "1");
    judge.mockClear();
    await snap(root.id, LOST);
    expect(await poll()).toMatchObject({
      status: "ERROR",
      judge: null,
      output: { infrastructure: { code: "context_organizer_failed" } },
    });
    expect(
      await prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: root.id } }),
    ).toMatchObject({ qualityScore: null, qualityVerdict: null });
    expect(judge).not.toHaveBeenCalled();
    await snap(root.id, HEALTHY);
    await scored();
    const child = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId,
        workspaceId: id,
        parentTurnId: root.id,
        source: "EVENT",
        status: "COMPLETED",
        clientTurnId: randomUUID(),
        userMessage: "child",
        capabilityNames: [],
        deadlineAt: new Date(),
      },
    });
    await snap(child.id, LOST);
    expect(await poll()).toMatchObject({
      status: "ERROR",
      output: { infrastructure: { detail: expect.stringContaining("1 of 2") } },
    });
    vi.stubEnv("SOKO_BOT_LOCAL_CHATGPT_PLAN", "0");
    await scored();
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it("counts a month's own production wake and a finish turn's wake, never another request's", async () => {
    vi.stubEnv("SOKO_BOT_LOCAL_CHATGPT_PLAN", "1");
    const id = await owner();
    const sokoBotId = randomUUID();
    const projectId = randomUUID();
    const strategyId = randomUUID();
    const approvedAt = new Date(Date.now() - 30_000);
    const startedAt = new Date(Date.now() - 60_000);
    await prisma.project.create({
      data: { id: projectId, workspaceId: id, name: "Fixture Project" },
    });
    await prisma.sokoBot.create({
      data: {
        id: sokoBotId,
        userId: null,
        workspaceId: id,
        projectId,
        versionId: "cmo-v24",
      },
    });
    await prisma.marketingStrategy.create({
      data: {
        id: strategyId,
        projectId,
        authorSokoBotId: sokoBotId,
        approvedAt,
        approvedByUserId: id,
        plan: {},
      },
    });
    const turn = (
      clientTurnId: string,
      source: Prisma.SokoBotTurnCreateInput["source"],
      parentTurnId?: string,
    ) =>
      prisma.sokoBotTurn.create({
        data: {
          sokoBotId,
          workspaceId: id,
          requestedByUserId: id,
          source,
          status: "COMPLETED",
          versionId: "cmo-v24",
          route: "MANAGE_WORK",
          clientTurnId,
          ...(parentTurnId ? { parentTurnId } : {}),
          userMessage: "Continue work on the monthly draft.",
          finalAnswer: "Done.",
          capabilityNames: [],
          deadlineAt: new Date(),
        },
      });
    async function fireWatch(
      issuer: Awaited<ReturnType<typeof turn>>,
      provider: string,
    ) {
      const receipt = await registerWatch(
        {
          turn: { ...issuer, botProjectId: projectId, actingUserId: id },
          askedByKind: "OWNER",
        } as unknown as Parameters<typeof registerWatch>[0],
        { kind: "app_connected", id: provider, then: "Read the new calendar." },
      );
      await prisma.sokoBotToolCall.create({
        data: {
          turnId: issuer.id,
          toolCallId: randomUUID(),
          inputHash: randomUUID(),
          capability: "wait_for",
          status: "COMPLETED",
          result: jsonInput(receipt),
        },
      });
      await prisma.sokoBotIntegration.create({
        data: {
          sokoBotId,
          provider,
          composioAccountId: `fixture-${randomUUID()}`,
          status: "ACTIVE",
        },
      });
      const start = vi
        .spyOn(sokoBotControlPlane, "startTurn")
        .mockImplementation(async (input) => {
          const row = await turn(
            input.clientTurnId!,
            input.source!,
            input.background?.parentTurnId,
          );
          return {
            turnId: row.id,
            sokoBotId,
            sessionId: "fixture",
            status: "COMPLETED",
            route: "MANAGE_WORK",
            capabilities: [],
            duplicate: false,
          };
        });
      try {
        expect(
          await syncSokoBotWatches({ sokoBotId, shouldContinue: () => true }),
        ).toMatchObject({ fired: 1 });
      } finally {
        start.mockRestore();
      }
      const fired = await prisma.sokoBotWatch.findUniqueOrThrow({
        where: { id: (receipt as { watchId: string }).watchId },
      });
      return prisma.sokoBotTurn.findUniqueOrThrow({
        where: { id: fired.firedTurnId! },
      });
    }
    const lane = {
      userId: id,
      workspaceId: id,
      cusoBotId: sokoBotId,
      cusoProjectId: projectId,
      lane: 1,
    } as EvalLaneRecord;
    // A plain month: production, then its own checks.
    const SPECIAL = ["writes", "pictures", "variety", "openings", "newsletter"];
    const month = CMO_EVAL_CASES.find(
      (c) =>
        c.kind === "cmo-month" &&
        !SPECIAL.some((key) => (c as Record<string, unknown>)[key]),
    )!;
    const storedMonth = () =>
      stored(month.id, lane, null, { strategyId }, startedAt);

    // Production runs under the chat turn; its wake is a sibling there.
    const root = await turn(randomUUID(), "CHAT");
    const production = await turn(
      `${CMO_PRODUCTION_TURN_PREFIX}${sokoBotId}:${approvedAt.getTime()}:1`,
      "EVENT",
      root.id,
    );
    const wake = await fireWatch(production, "googlecalendar");
    expect(wake.parentTurnId).toBe(root.id);
    await snap(wake.id, LOST);
    expect(await storedMonth()).toMatchObject({
      status: "ERROR",
      output: { infrastructure: { code: "context_organizer_failed" } },
    });
    await prisma.sokoBotContextSnapshot.deleteMany({
      where: { turnId: wake.id },
    });
    expect(await storedMonth()).toMatchObject({ status: "FAILED" });

    // Another request's wake, timed out during the month, is not the month's.
    const other = await turn(`separate-owner-question:${randomUUID()}`, "CHAT");
    const otherWake = await fireWatch(other, "hubspot");
    await snap(otherWake.id, LOST);
    expect(await storedMonth()).toMatchObject({ status: "FAILED" });

    // A strategy case's finish turn and its wake.
    const strategyTurn = await turn(
      `${STRATEGY_TURN_PREFIX}${sokoBotId}:first`,
      "EVENT",
    );
    const finish = await turn(
      `${STRATEGY_TURN_PREFIX}${sokoBotId}:finish:2`,
      "EVENT",
    );
    const finishWake = await turn(
      `watch:${randomUUID()}`,
      "SCHEDULE",
      await watchOriginTurnId(finish.id),
    );
    await snap(finishWake.id, LOST);
    const strategy = CMO_EVAL_CASES.find(
      (c) =>
        c.kind === "cmo-strategy" &&
        c.brand.focus !== "claims" &&
        !c.brand.testerCredits,
    )!;
    expect(
      await stored(strategy.id, lane, strategyTurn.id, {}, startedAt),
    ).toMatchObject({
      status: "ERROR",
      output: { infrastructure: { code: "context_organizer_failed" } },
    });
  });
});
