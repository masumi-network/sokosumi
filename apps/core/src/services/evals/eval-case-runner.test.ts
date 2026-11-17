import { SOKO_BOT_SCENARIOS } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectCoreLogWhys } from "@/test/core-log";

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

  it("scores a turn by its checks when the judge fails, without the judge's error text", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Could not judge an eval turn, so it is scored by its checks alone",
      ["Judging the turn threw"],
    );
    boundary.load.mockResolvedValue({ ...base, errorKind: "validation" });
    // The judge reads the turn's messages, and its error can quote them.
    boundary.judge.mockRejectedValue(
      new Error('turn "Confidential merger with Acme" sk_live_abc123'),
    );

    const result = await pollEvalCase(
      definition,
      lane,
      { turnId: "turn-judge", state: {} },
      context,
    );

    expect(result).toMatchObject({ kind: "done" });
    expect(warnings[0]?.event).toMatchObject({
      operation: "eval_tick",
      evalJudgeFailures: [{ turnId: "turn-judge", errorName: "Error" }],
    });
    const drained = JSON.stringify(warnings[0]?.event);
    expect(drained).not.toContain("Confidential merger");
    expect(drained).not.toContain("sk_live");
  });
});
