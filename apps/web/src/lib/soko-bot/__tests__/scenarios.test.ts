import { describe, expect, it } from "vitest";

import type { ChatTurnDetail } from "../chat-state";
import {
  evaluateScenario,
  SOKO_BOT_SCENARIOS,
  type SokoBotScenario,
} from "../scenarios";

function turn(overrides: Partial<ChatTurnDetail>): ChatTurnDetail {
  return {
    id: "t1",
    source: "CHAT",
    status: "COMPLETED",
    route: "DELEGATE_TASK",
    userMessage: "x",
    finalAnswer: "Done.",
    errorKind: null,
    errorDetail: null,
    startedAt: null,
    completedAt: null,
    durationMs: 1000,
    createdAt: "2026-08-25T00:00:00.000Z",
    events: [],
    delegations: [],
    decisions: [],
    requestedBy: null,
    chatRoom: null,
    classification: null,
    classifierModel: null,
    classifierLatencyMs: null,
    classificationFailed: false,
    capabilityNames: [],
    modelId: null,
    usage: null,
    toolCalls: [],
    contextSummary: null,
    ...overrides,
  };
}

function call(capability: string): ChatTurnDetail["toolCalls"][number] {
  return {
    id: capability,
    capability,
    status: "COMPLETED",
    result: null,
    errorKind: null,
    errorDetail: null,
    createdAt: "2026-08-25T00:00:00.000Z",
  };
}

const byId = (id: string): SokoBotScenario => {
  const scenario = SOKO_BOT_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(id);
  return scenario;
};

describe("evaluateScenario", () => {
  it("ships six scenarios with unique ids", () => {
    expect(SOKO_BOT_SCENARIOS).toHaveLength(6);
    expect(new Set(SOKO_BOT_SCENARIOS.map((s) => s.id)).size).toBe(6);
  });

  it("passes a delegated brief that created a task", () => {
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [
          call("find_coworkers"),
          call("create_task"),
          call("create_schedule"),
        ],
        finalAnswer: "Created it and I'll check every weekday at 9.",
        delegations: [
          {
            id: "d1",
            kind: "TASK",
            action: "create_task",
            outcome: "ok",
            error: null,
            taskId: "task-1",
            jobId: null,
          },
        ],
      }),
    );
    expect(result.passed).toBe(result.total);
  });

  it("fails when a forbidden tool ran or the route drifted", () => {
    const result = evaluateScenario(
      byId("ambiguous-request"),
      turn({
        route: "DELEGATE_TASK",
        toolCalls: [call("create_task")],
        finalAnswer: "Created it.",
      }),
    );
    const failed = result.checks.filter((c) => !c.pass).map((c) => c.label);
    expect(failed).toEqual([
      "Route ∈ CLARIFY",
      "Never calls create_task, hire_agent, assign_task",
      "Asks a question",
    ]);
  });

  it("accepts a hire only when it went through an approval", () => {
    const scenario = byId("hire-agent-with-budget");
    const silent = evaluateScenario(
      scenario,
      turn({
        route: "HIRE_AGENT",
        toolCalls: [call("find_agents"), call("hire_agent")],
      }),
    );
    expect(silent.checks.at(-1)).toMatchObject({
      pass: false,
      actual: "hired without asking",
    });
    const asked = evaluateScenario(
      scenario,
      turn({
        route: "HIRE_AGENT",
        toolCalls: [call("find_agents"), call("request_user_decision")],
      }),
    );
    expect(asked.passed).toBe(asked.total);
  });

  it("fails a bare promise to follow up without a schedule", () => {
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [call("create_task")],
        finalAnswer: "Task created. I will check on it daily.",
        delegations: [
          {
            id: "d1",
            kind: "TASK",
            action: "create_task",
            outcome: "ok",
            error: null,
            taskId: "task-1",
            jobId: null,
          },
        ],
      }),
    );
    const failed = result.checks.filter((c) => !c.pass).map((c) => c.label);
    expect(failed).toEqual([
      "Calls create_schedule",
      "No follow-up promise without a schedule",
    ]);
  });

  it("counts tools from the event stream too", () => {
    const result = evaluateScenario(
      byId("launch-plan-weekly-nudge"),
      turn({
        events: [
          {
            id: "e1",
            sequence: 1,
            type: "actions.requested",
            toolName: "update_memory",
            toolStatus: null,
            summary: null,
            durationMs: null,
            payload: null,
            createdAt: "2026-08-25T00:00:00.000Z",
          },
        ],
        toolCalls: [call("create_task"), call("create_schedule")],
        delegations: ["a", "b", "c"].map((id) => ({
          id,
          kind: "TASK" as const,
          action: "create_task",
          outcome: "ok",
          error: null,
          taskId: id,
          jobId: null,
        })),
      }),
    );
    expect(result.passed).toBe(result.total);
  });
});
