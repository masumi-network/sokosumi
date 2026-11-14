import { describe, expect, it } from "vitest";
import { toolRecoveryFeedback } from "./tool-recovery-feedback";

describe("toolRecoveryFeedback", () => {
  it("explains an empty directory without inventing assignees", () => {
    const feedback = toolRecoveryFeedback("find_coworkers", {
      people: [],
      coworkers: [],
      available: 0,
    });
    expect(feedback).toEqual({
      people: [],
      coworkers: [],
      available: 0,
      instruction: expect.stringContaining("Retry without a query"),
    });
  });
  it("preserves a successful lookup unchanged", () => {
    const result = {
      people: [{ userId: "hannah", name: "Hannah" }],
      coworkers: [],
    };
    expect(toolRecoveryFeedback("find_coworkers", result)).toBe(result);
  });
  it("identifies listed bot schedules even when they monitor a Task", () => {
    expect(
      toolRecoveryFeedback("list_schedules", [
        { id: "check-1", taskId: "task-1", name: "Research check" },
      ]),
    ).toEqual([
      {
        id: "check-1",
        taskId: "task-1",
        name: "Research check",
        previewReference: { kind: "bot_schedule", id: "check-1" },
      },
    ]);
  });
  it("does not recommend READY for a Task with no assignee of any kind", () => {
    const result = {
      id: "task-1",
      status: "INPUT_REQUIRED",
      assigneeUserId: null,
      assigneeCoworkerId: null,
      assigneeSokoBotId: null,
    };
    expect(toolRecoveryFeedback("get_task_status", result)).toMatchObject({
      ...result,
      instruction: expect.stringContaining("without a status change"),
    });
  });
  it("keeps required handoff work visible when a completed Task is read", () => {
    const result = { id: "task-1", status: "COMPLETED", files: [] };
    expect(toolRecoveryFeedback("get_task_status", result)).toMatchObject({
      ...result,
      instruction: expect.stringContaining("linked follow-up Task"),
    });
  });
  it.each(["assigneeUserId", "assigneeCoworkerId", "assigneeSokoBotId"])(
    "does not call a Task unassigned when %s is present",
    (field) => {
      const result = {
        id: "task-1",
        status: "INPUT_REQUIRED",
        assigneeUserId: null,
        assigneeCoworkerId: null,
        assigneeSokoBotId: null,
        [field]: "assignee-1",
      };
      expect(toolRecoveryFeedback("get_task_status", result)).toBe(result);
    },
  );
  it("distinguishes a deleted schedule from an available preview", () => {
    const feedback = toolRecoveryFeedback("delete_schedule", {
      id: "deleted-1",
      name: "Old check",
      deleted: true,
    });
    expect(feedback).toMatchObject({
      id: "deleted-1",
      name: "Old check",
      instruction: expect.stringContaining("do not call preview_result"),
    });
  });
  it("does not treat an ID alone as proof of deletion", () => {
    const result = { id: "schedule-1", deleted: false };
    expect(toolRecoveryFeedback("delete_schedule", result)).toBe(result);
  });
  it("makes a missing structural Task link visible without inventing one", () => {
    const result = { id: "check-1", taskId: null, runOnce: true };
    expect(toolRecoveryFeedback("create_schedule", result)).toMatchObject({
      ...result,
      instruction: expect.stringContaining(
        "use create_schedule with the verified taskId",
      ),
    });
    const linked = { ...result, taskId: "task-1" };
    expect(toolRecoveryFeedback("create_schedule", linked)).toMatchObject({
      ...linked,
      previewReference: { kind: "bot_schedule", id: "check-1" },
    });
  });
  it.each([
    "find_coworkers",
    "get_task_status",
    "delete_schedule",
    "create_schedule",
  ])("does not invent success for %s", (capability) => {
    const result = { error: "unavailable" };
    expect(toolRecoveryFeedback(capability, result)).toBe(result);
  });
});
