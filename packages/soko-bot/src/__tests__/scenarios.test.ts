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

function call(
  capability: string,
  result: unknown = null,
): SokoBotLabTurn["toolCalls"][number] {
  return { capability, status: "COMPLETED", result };
}

/** A schedule row as the tool returns it, naming the Task it watches. */
function scheduleFor(taskId: string) {
  return { id: "sch-1", prompt: `Check on task ${taskId} and nudge me.` };
}

const byId = (id: string): SokoBotScenario => {
  const scenario = SOKO_BOT_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(id);
  return scenario;
};

describe("evaluateScenario", () => {
  it("gives every scenario a unique id", () => {
    // The count is incidental and changed every time a scenario was added;
    // uniqueness is what the lab actually depends on to address a scenario.
    const ids = SOKO_BOT_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("keeps scenarios that reward restraint", () => {
    // Every other scenario rewards doing something, so without these a bot
    // that invents work to look busy would score well.
    const silent = SOKO_BOT_SCENARIOS.filter(
      (scenario) => scenario.expect.staysSilent,
    );
    expect(silent.length).toBeGreaterThanOrEqual(2);
  });

  it("passes a quiet stand-up that changed nothing", () => {
    const result = evaluateScenario(
      byId("quiet-standup"),
      turn({
        route: "DIRECT_RESPONSE",
        finalAnswer: "Nothing to add.",
      }),
    );

    expect(result.passed).toBe(result.total);
  });

  it("fails a quiet stand-up that invented work to look busy", () => {
    // The failure this scenario exists for: a Task drafted from a newsletter
    // so the turn has something to report.
    const result = evaluateScenario(
      byId("quiet-standup"),
      turn({
        route: "DIRECT_RESPONSE",
        toolCalls: [call("create_task")],
        finalAnswer: "Nothing to add, but I drafted a task for the newsletter.",
        delegations: [{ id: "d1", taskId: "task-1", jobId: null }],
      }),
    );

    expect(result.passed).toBeLessThan(result.total);
    expect(
      result.checks.some(
        (check) => check.label === "Changes nothing" && !check.pass,
      ),
    ).toBe(true);
  });

  it("fails a quiet delta that padded the answer instead of stopping", () => {
    const result = evaluateScenario(
      byId("quiet-delta"),
      turn({
        route: "DIRECT_RESPONSE",
        finalAnswer:
          "Nothing to add. " +
          "Here is a summary of the newsletters that arrived anyway: ".repeat(
            5,
          ),
      }),
    );

    expect(result.passed).toBeLessThan(result.total);
  });

  it("covers every automated trigger the crons drive", () => {
    // A broken cron path should surface as a failed scenario, not as a quiet
    // afternoon nobody can explain.
    const beats = new Set(
      SOKO_BOT_SCENARIOS.flatMap((scenario) =>
        scenario.trigger?.kind === "ingest" ? [scenario.trigger.beat] : [],
      ),
    );
    expect(beats).toEqual(new Set(["standup", "weekly-wrap", "delta"]));
    expect(
      SOKO_BOT_SCENARIOS.some(
        (scenario) => scenario.trigger?.kind === "task_event",
      ),
    ).toBe(true);
  });

  it("passes a delegated brief that created a task", () => {
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [
          call("find_coworkers"),
          call("create_task"),
          call("create_schedule", scheduleFor("task-1")),
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

  it("accepts an existing daily schedule pointed at the new task", () => {
    // Reusing the schedule the owner already has is a real follow-up, and a
    // tidier one than a second daily check-in beside it.
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [
          call("create_task"),
          call("update_schedule", scheduleFor("task-1")),
        ],
        finalAnswer: "Created the brief and pointed your daily check at it.",
        delegations: [{ id: "d1", taskId: "task-1", jobId: null }],
      }),
    );

    expect(result.checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("names the tool that failed rather than only listing it", () => {
    // "No failed tool calls — assign_task" reads as an answer to the label.
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [
          call("create_task"),
          { ...call("assign_task"), status: "FAILED" },
        ],
      }),
    );

    const check = result.checks.find((c) => c.label === "No failed tool calls");
    expect(check?.actual).toBe("assign_task failed");
  });

  it("says a tool was never called instead of printing the haystack", () => {
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({ toolCalls: [call("get_task_status")] }),
    );

    const check = result.checks.find((c) => c.label === "Calls create_task");
    expect(check?.actual).toBe("never called — used get_task_status");
  });

  it("fails a schedule left pointing at some other task", () => {
    // "Called a schedule tool" is not the same as following up on the brief:
    // reusing yesterday's check-in without repointing it watches the wrong
    // work and reads, from the outside, exactly like success.
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [
          call("create_task"),
          call("update_schedule", scheduleFor("some-older-task")),
        ],
        delegations: [{ id: "d1", taskId: "task-1", jobId: null }],
      }),
    );

    const check = result.checks.find(
      (c) => c.label === "Schedule names a task from this turn",
    );
    expect(check?.pass).toBe(false);
    expect(check?.actual).toBe("schedule points somewhere else");
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
      "Calls one of create_schedule, update_schedule",
      "Schedule names a task from this turn",
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
