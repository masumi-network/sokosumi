import { TaskStatus } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  getColumnId,
  getColumnListQueryOptions,
} from "@/app/tasks/utils/task-column";

describe("getColumnId", () => {
  it("maps READY tasks to todo by default", () => {
    expect(getColumnId(TaskStatus.READY)).toBe("todo");
  });

  it("maps GRANT_PENDING tasks to input-required", () => {
    expect(getColumnId(TaskStatus.GRANT_PENDING)).toBe("input-required");
  });

  it("keeps DRAFT tasks in backlog", () => {
    expect(getColumnId(TaskStatus.DRAFT)).toBe("backlog");
  });
});

describe("getColumnListQueryOptions", () => {
  it("returns todo column statuses", () => {
    expect(getColumnListQueryOptions("todo", null)).toEqual({
      statuses: [TaskStatus.READY, TaskStatus.CREDITS_TOPPED_UP],
    });
  });

  it("returns input-required column statuses including GRANT_PENDING", () => {
    expect(getColumnListQueryOptions("input-required", null)).toEqual({
      statuses: [
        TaskStatus.GRANT_PENDING,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.APPROVAL_REQUIRED,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.OUT_OF_CREDITS,
      ],
    });
  });

  it("filters input-required to GRANT_PENDING when selected", () => {
    expect(
      getColumnListQueryOptions("input-required", TaskStatus.GRANT_PENDING),
    ).toEqual({
      statuses: [TaskStatus.GRANT_PENDING],
    });
  });

  it("filters input-required to a single non-grant status", () => {
    expect(
      getColumnListQueryOptions("input-required", TaskStatus.INPUT_REQUIRED),
    ).toEqual({
      statuses: [TaskStatus.INPUT_REQUIRED],
    });
  });

  it("keeps only waiting columns under Stuck", () => {
    expect(getColumnListQueryOptions("backlog", null, true)).toEqual({
      statuses: [],
    });
    expect(getColumnListQueryOptions("done", null, true)).toEqual({
      statuses: [],
    });
    expect(getColumnListQueryOptions("todo", null, true)).toEqual({
      statuses: [TaskStatus.READY, TaskStatus.CREDITS_TOPPED_UP],
    });
  });
});
