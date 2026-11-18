import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { judgeEvalScenarioTurn } from "@/services/soko-bot-lab-judge.service";
import { loadLabScenarioTurn } from "@/services/soko-bot-lab-scenario.service";
import { pollEvalCase } from "./eval-case-runner";
import { evalCase } from "./eval-cases";
import { type EvalLaneRecord, ensureEvalLanes } from "./eval-lanes.service";

vi.mock("@/services/soko-bot-lab-judge.service", () => ({
  judgeEvalScenarioTurn: vi.fn(async () => null),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const BUDGET_FAILURE_DETAIL =
  "API key budget exceeded. Current spend: $400.12, limit: $400.00.";
const runIds: string[] = [];
const turnIds: string[] = [];
let lane: EvalLaneRecord;

describe.skipIf(!enabled)("persisted evaluation execution failures", () => {
  beforeAll(async () => {
    const lanes = await ensureEvalLanes(1);
    if (!lanes[0]) throw new Error("Missing registered eval lane");
    lane = lanes[0];
  });

  afterAll(async () => {
    await prisma.sokoBotTurn.deleteMany({ where: { id: { in: turnIds } } });
    await prisma.evalRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.$disconnect();
  });

  it("loads a real failed turn and stops before behavioral scoring or a paid judge", async () => {
    const definition = evalCase("ambiguous-request");
    if (!definition || definition.kind !== "scenario")
      throw new Error("Missing generic ambiguous-request case");
    const scenario = definition.scenario;
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
        caseId: scenario.id,
        suite: "soko-bot",
        repeat: lane.lane,
        position: 0,
        status: "RUNNING",
      },
    });
    const turn = await prisma.sokoBotTurn.create({
      data: {
        id: randomUUID(),
        sokoBotId: lane.sokoBotId,
        workspaceId: lane.workspaceId,
        requestedByUserId: lane.userId,
        source: "CHAT",
        status: "FAILED",
        route: "CLARIFY",
        clientTurnId: `lab:eval:${result.id}`,
        userMessage: scenario.prompt,
        capabilityNames: [],
        errorKind: "GatewayInternalServerError",
        errorDetail: BUDGET_FAILURE_DETAIL,
        deadlineAt: new Date(Date.now() + 60_000),
      },
    });
    turnIds.push(turn.id);
    await prisma.evalResult.update({
      where: { id: result.id },
      data: { turnId: turn.id },
    });
    const loaded = await loadLabScenarioTurn(turn.id);
    expect(loaded).toMatchObject({
      errorKind: "GatewayInternalServerError",
      errorDetail: BUDGET_FAILURE_DETAIL,
    });
    const polled = await pollEvalCase(
      definition,
      lane,
      { turnId: turn.id, state: {} },
      { resultId: result.id, firstOfSuite: false, startedAt: turn.createdAt },
    );
    expect(polled).toMatchObject({
      kind: "done",
      outcome: {
        status: "ERROR",
        checks: [],
        turnIds: [turn.id],
        output: {
          infrastructure: {
            code: "provider_budget_exhausted",
            detail: BUDGET_FAILURE_DETAIL,
          },
        },
      },
    });
    expect(judgeEvalScenarioTurn).not.toHaveBeenCalled();
  });
});
