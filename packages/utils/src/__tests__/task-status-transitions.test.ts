import { describe, expect, it } from "vitest";

import { TaskStatus } from "../task-status.js";
import { canUserTransitionTaskStatus } from "../task-status-transitions.js";

describe("canUserTransitionTaskStatus", () => {
  it("rejects same-status transitions", () => {
    expect(
      canUserTransitionTaskStatus(TaskStatus.READY, TaskStatus.READY),
    ).toBe(false);
  });

  it.each([
    [TaskStatus.DRAFT, TaskStatus.QUEUED],
    [TaskStatus.QUEUED, TaskStatus.READY],
    [TaskStatus.READY, TaskStatus.QUEUED],
  ])("accepts %s → %s", (from, to) => {
    expect(canUserTransitionTaskStatus(from, to)).toBe(true);
  });

  it("rejects CANCELED → DRAFT (terminal)", () => {
    expect(
      canUserTransitionTaskStatus(TaskStatus.CANCELED, TaskStatus.DRAFT),
    ).toBe(false);
  });

  it("rejects CREDITS_TOPPED_UP → QUEUED (scheduled column drag)", () => {
    expect(
      canUserTransitionTaskStatus(
        TaskStatus.CREDITS_TOPPED_UP,
        TaskStatus.QUEUED,
      ),
    ).toBe(false);
  });
});
