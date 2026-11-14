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
    expect(toolRecoveryFeedback("create_schedule", linked)).toBe(linked);
  });
  it.each(["find_coworkers", "delete_schedule", "create_schedule"])(
    "does not invent success for %s",
    (capability) => {
      const result = { error: "unavailable" };
      expect(toolRecoveryFeedback(capability, result)).toBe(result);
    },
  );
});
