import { describe, expect, it } from "vitest";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import { TASK_STATUS_DISPLAY_ORDER } from "@/lib/utils/task-status-order";

describe("task status label builders", () => {
  it("buildTaskStatusLabels maps every status in display order", () => {
    const labels = buildTaskStatusLabels((key) => `full:${key}`);

    expect(Object.keys(labels)).toHaveLength(TASK_STATUS_DISPLAY_ORDER.length);

    for (const status of TASK_STATUS_DISPLAY_ORDER) {
      expect(labels[status]).toBe(`full:${status}`);
    }
  });
});
