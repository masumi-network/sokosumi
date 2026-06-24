import { describe, expect, it } from "vitest";
import {
  isTaskEditableStatus,
  TASK_EDITABLE_STATUSES,
} from "../task-editable.js";
import { TaskStatus } from "../task-status.js";

describe("isTaskEditableStatus", () => {
  it.each(TASK_EDITABLE_STATUSES)("returns true for %s", (status) => {
    expect(isTaskEditableStatus(status)).toBe(true);
  });

  it.each([
    TaskStatus.RUNNING,
    TaskStatus.COMPLETED,
    TaskStatus.INPUT_REQUIRED,
  ] as const)("returns false for %s", (status) => {
    expect(isTaskEditableStatus(status)).toBe(false);
  });
});
