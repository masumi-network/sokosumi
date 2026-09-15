import { describe, expect, it } from "vitest";
import { TaskStatus } from "@/lib/clients/generated/core";

import {
  canSelectQueuedTaskStatus,
  TASK_STATUS_DISPLAY_ORDER,
} from "@/lib/utils/task-status-order";

describe("canSelectQueuedTaskStatus", () => {
  it("requires both an agent assignee and an active schedule", () => {
    expect(
      canSelectQueuedTaskStatus({ hasSchedule: true, isAgent: true }),
    ).toBe(true);
    expect(
      canSelectQueuedTaskStatus({ hasSchedule: false, isAgent: true }),
    ).toBe(false);
    expect(
      canSelectQueuedTaskStatus({ hasSchedule: true, isAgent: false }),
    ).toBe(false);
  });
});

describe("TASK_STATUS_DISPLAY_ORDER", () => {
  it("includes every TaskStatus exactly once", () => {
    const allStatuses = Object.values(TaskStatus);
    const orderedStatuses = [...TASK_STATUS_DISPLAY_ORDER];

    expect(orderedStatuses).toHaveLength(allStatuses.length);
    expect(new Set(orderedStatuses).size).toBe(allStatuses.length);

    for (const status of allStatuses) {
      expect(orderedStatuses).toContain(status);
    }
  });
});
