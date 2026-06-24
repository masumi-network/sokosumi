import { describe, expect, it } from "vitest";

import { TaskStatus } from "../task-status.js";
import {
  isTaskEditableStatus,
  TASK_EDITABLE_STATUSES,
} from "../task-editable.js";

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
