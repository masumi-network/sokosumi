import { TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  getColumnId,
  getColumnListQueryOptions,
} from "@/lib/utils/task-column";

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

describe("getColumnListQueryOptions", () => {
  it("excludes parked READY tasks from todo column queries", () => {
    expect(getColumnListQueryOptions("todo", null)).toEqual({
      statuses: [TaskStatus.READY, TaskStatus.CREDITS_TOPPED_UP],
      pendingApproval: false,
    });
  });

  it("includes parked READY tasks via includeParkedReady for input-required", () => {
    expect(getColumnListQueryOptions("input-required", null)).toEqual({
      statuses: [
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.APPROVAL_REQUIRED,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.OUT_OF_CREDITS,
      ],
      includeParkedReady: true,
    });
  });

  it("filters input-required READY status to parked tasks only", () => {
    expect(
      getColumnListQueryOptions("input-required", TaskStatus.READY),
    ).toEqual({
      statuses: [TaskStatus.READY],
      pendingApproval: true,
    });
  });

  it("does not add parked READY when filtering input-required to another status", () => {
    expect(
      getColumnListQueryOptions("input-required", TaskStatus.INPUT_REQUIRED),
    ).toEqual({
      statuses: [TaskStatus.INPUT_REQUIRED],
      includeParkedReady: false,
    });
  });
});
