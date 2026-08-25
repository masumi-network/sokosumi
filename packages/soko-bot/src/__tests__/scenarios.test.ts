import { describe, expect, it } from "vitest";

import {
  evaluateScenario,
  SOKO_BOT_SCENARIOS,
  type SokoBotLabTurn,
  type SokoBotScenario,
} from "../scenarios.js";

function turn(overrides: Partial<SokoBotLabTurn>): SokoBotLabTurn {
  return {
    status: "COMPLETED",
    route: "DELEGATE_TASK",
    finalAnswer: "Done.",
    toolCalls: [],
    events: [],
    delegations: [],
    decisions: [],
    ...overrides,
  };
}

function call(capability: string): SokoBotLabTurn["toolCalls"][number] {
  return { capability, status: "COMPLETED", result: null };
}

const byId = (id: string): SokoBotScenario => {
  const scenario = SOKO_BOT_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(id);
  return scenario;
};

describe("evaluateScenario", () => {
  it("ships nine scenarios with unique ids", () => {
    expect(SOKO_BOT_SCENARIOS).toHaveLength(9);
    expect(new Set(SOKO_BOT_SCENARIOS.map((s) => s.id)).size).toBe(9);
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
        delegations: [{ id: "d1", taskId: "task-1", jobId: null }],
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

  it("passes a budget-respecting hire that only used marketplace tools", () => {
    const result = evaluateScenario(
      byId("hire-agent-with-budget"),
      turn({
        route: "HIRE_AGENT",
        toolCalls: [call("find_agents"), call("get_agent_input_schema")],
        finalAnswer: "Nothing under 10 credits; the cheapest fit costs 60.",
      }),
    );
    expect(result.passed).toBe(result.total);
  });

  it("fails a bare promise to follow up without a schedule", () => {
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [call("create_task")],
        finalAnswer: "Task created. I will check on it daily.",
        delegations: [{ id: "d1", taskId: "task-1", jobId: null }],
      }),
    );
    const failed = result.checks.filter((c) => !c.pass).map((c) => c.label);
    expect(failed).toEqual([
      "Calls create_schedule",
      "No follow-up promise without a schedule",
    ]);
  });

  it("flags ids that no tool result produced", () => {
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [call("create_task"), call("create_schedule")],
        finalAnswer:
          "Created task 01a039e2-1a0a-713e-903e-3f5f3a9b9d7a and scheduled check-ins.",
      }),
    );
    expect(result.checks.at(-1)).toMatchObject({
      pass: false,
      actual: "invented 01a039e2-1a0a-713e-903e-3f5f3a9b9d7a",
    });
  });

  it("counts tools from the event stream too", () => {
    const result = evaluateScenario(
      byId("launch-plan-weekly-nudge"),
      turn({
        events: [{ type: "actions.requested", toolName: "update_memory" }],
        toolCalls: [call("create_task"), call("create_schedule")],
        delegations: ["a", "b", "c"].map((id) => ({
          id,
          taskId: id,
          jobId: null,
        })),
      }),
    );
    expect(result.passed).toBe(result.total);
  });
});
