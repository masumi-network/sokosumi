import { describe, expect, it } from "vitest";
import {
  buildTaskStatusAbbreviationLabels,
  buildTaskStatusLabels,
} from "@/app/tasks/utils/task-status-labels";
import { TaskStatus } from "@/lib/clients/generated/core";
import { TASK_STATUS_DISPLAY_ORDER } from "@/lib/utils/task-status-order";

describe("task status label builders", () => {
  it("buildTaskStatusLabels maps every status in display order", () => {
    const labels = buildTaskStatusLabels((key) => `full:${key}`);

    expect(Object.keys(labels)).toHaveLength(TASK_STATUS_DISPLAY_ORDER.length);

    for (const status of TASK_STATUS_DISPLAY_ORDER) {
      expect(labels[status]).toBe(`full:${status}`);
    }
  });

  it("buildTaskStatusAbbreviationLabels maps every status in display order", () => {
    const labels = buildTaskStatusAbbreviationLabels((key) => `abbr:${key}`);

    expect(Object.keys(labels)).toHaveLength(TASK_STATUS_DISPLAY_ORDER.length);

    for (const status of TASK_STATUS_DISPLAY_ORDER) {
      expect(labels[status]).toBe(`abbr:${status}`);
    }
  });

  it("returns distinct namespaces for full and abbreviated labels", () => {
    const full = buildTaskStatusLabels((key) => `full:${key}`);
    const abbreviated = buildTaskStatusAbbreviationLabels(
      (key) => `abbr:${key}`,
    );

    expect(full[TaskStatus.QUEUED]).toBe("full:QUEUED");
    expect(abbreviated[TaskStatus.QUEUED]).toBe("abbr:QUEUED");
  });
});
