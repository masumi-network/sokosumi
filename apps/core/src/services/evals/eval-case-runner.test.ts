import { SOKO_BOT_SCENARIOS } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ load: vi.fn(), judge: vi.fn() }));
vi.mock("@/services/soko-bot-lab-scenario.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/soko-bot-lab-scenario.service")
  >()),
  loadLabScenarioTurn: boundary.load,
}));
vi.mock("@/services/soko-bot-lab-judge.service", () => ({
  judgeEvalScenarioTurn: boundary.judge,
}));

import { pollEvalCase } from "./eval-case-runner";
import type { EvalCase } from "./eval-cases";
import type { EvalLaneRecord } from "./eval-lanes.service";

const scenario = SOKO_BOT_SCENARIOS.find(
  (entry) => entry.id === "ambiguous-request",
)!;
const definition = {
  kind: "scenario",
  id: scenario.id,
  suite: "soko-bot",
  bot: "soko-bot",
  scenario,
} as EvalCase;
const lane = { lane: 1, userId: "owner" } as EvalLaneRecord;
const context = {
  resultId: "result",
  firstOfSuite: false,
  startedAt: new Date(),
};
const base = {
  status: "FAILED",
  route: "CLARIFY",
  finalAnswer: null,
  durationMs: 100,
  errorKind: "GatewayInternalServerError",
  errorDetail:
    "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
  toolCalls: [],
  events: [],
  delegations: [],
  decisions: [],
  contextPacket: null,
  costUsd: null,
};

describe("evaluation execution failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.judge.mockResolvedValue(null);
  });

  it("records a budget-blocked turn as ERROR without behavioral checks or a paid judge", async () => {
    boundary.load.mockResolvedValue(base);
    const result = await pollEvalCase(
      definition,
      lane,
      { turnId: "turn-budget", state: {} },
      context,
    );
    expect(result).toMatchObject({
      kind: "done",
      outcome: {
        status: "ERROR",
        checks: [],
        turnIds: ["turn-budget"],
        output: {
          turnStatus: "FAILED",
          infrastructure: { code: "provider_budget_exhausted", stopsRun: true },
        },
      },
    });
    expect(boundary.judge).not.toHaveBeenCalled();
  });

  it("records runner exit as a separate execution ERROR with its diagnostic", async () => {
    boundary.load.mockResolvedValue({
      ...base,
      errorKind: "runner_exited",
      errorDetail: "The runner ended with exit code 1",
    });
    const result = await pollEvalCase(
      definition,
      lane,
      { turnId: "turn-exit", state: {} },
      context,
    );
    expect(result).toMatchObject({
      kind: "done",
      outcome: {
        status: "ERROR",
        checks: [],
        output: {
          infrastructure: {
            code: "runner_exited",
            stopsRun: false,
            detail: "The runner ended with exit code 1",
          },
        },
      },
    });
    expect(boundary.judge).not.toHaveBeenCalled();
  });

  it("retains scoring for completed behavioral failures", async () => {
    boundary.load.mockResolvedValue({
      ...base,
      status: "COMPLETED",
      route: "HIRE_AGENT",
      errorKind: null,
      errorDetail: null,
      finalAnswer: "Wrong behavior",
    });
    const result = await pollEvalCase(
      definition,
      lane,
      { turnId: "turn-behavior", state: {} },
      context,
    );
    expect(result).toMatchObject({
      kind: "done",
      outcome: { status: "FAILED" },
    });
    if (result.kind === "done")
      expect(result.outcome.checks.some((check) => !check.pass)).toBe(true);
    expect(boundary.judge).toHaveBeenCalledOnce();
  });

  it("does not turn an arbitrary FAILED turn into an infrastructure error", async () => {
    boundary.load.mockResolvedValue({ ...base, errorKind: "validation" });
    const result = await pollEvalCase(
      definition,
      lane,
      { turnId: "turn-validation", state: {} },
      context,
    );
    expect(result).toMatchObject({
      kind: "done",
      outcome: { status: "FAILED" },
    });
    expect(boundary.judge).toHaveBeenCalledOnce();
  });
});
