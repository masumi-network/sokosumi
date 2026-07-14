import { TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { getColumnId, getColumnQueryStatuses } from "@/lib/utils/task-column";

describe("getColumnId", () => {
  it("maps READY tasks to todo by default", () => {
    expect(getColumnId(TaskStatus.READY)).toBe("todo");
  });

  it("maps parked READY tasks to input-required without changing status semantics", () => {
    expect(getColumnId(TaskStatus.READY, { pendingApproval: true })).toBe(
      "input-required",
    );
    expect(getColumnId(TaskStatus.READY, { pendingApproval: false })).toBe(
      "todo",
    );
  });

  it("keeps parked DRAFT tasks in backlog", () => {
    expect(getColumnId(TaskStatus.DRAFT, { pendingApproval: true })).toBe(
      "backlog",
    );
  });
});

describe("getColumnQueryStatuses", () => {
  it("includes READY when loading input-required for parked grant tasks", () => {
    expect(getColumnQueryStatuses("input-required", null)).toContain(
      TaskStatus.READY,
    );
  });

  it("does not add READY to input-required when filtering to another status", () => {
    expect(
      getColumnQueryStatuses("input-required", TaskStatus.INPUT_REQUIRED),
    ).toEqual([TaskStatus.INPUT_REQUIRED]);
  });
});
