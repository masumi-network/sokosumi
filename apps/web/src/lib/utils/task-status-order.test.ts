import { describe, expect, it } from "vitest";
import { TaskStatus } from "@/lib/clients/generated/core";

import {
  canSelectQueuedTaskStatus,
  getManualTaskStatusSelectOptions,
  TASK_STATUS_DISPLAY_ORDER,
  TASK_STATUSES_HIDDEN_FROM_MANUAL_SELECT,
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

describe("getManualTaskStatusSelectOptions", () => {
  it("omits internal statuses from manual select options", () => {
    const options = getManualTaskStatusSelectOptions();

    for (const status of TASK_STATUSES_HIDDEN_FROM_MANUAL_SELECT) {
      expect(options).not.toContain(status);
    }
  });

  it("preserves TASK_STATUS_DISPLAY_ORDER for visible options", () => {
    const hidden = new Set<TaskStatus>(TASK_STATUSES_HIDDEN_FROM_MANUAL_SELECT);
    const expected = TASK_STATUS_DISPLAY_ORDER.filter(
      (status) => !hidden.has(status),
    );

    expect(getManualTaskStatusSelectOptions()).toEqual(expected);
  });

  it("includes the current status when it is hidden", () => {
    const options = getManualTaskStatusSelectOptions(TaskStatus.FAILED);

    expect(options).toContain(TaskStatus.FAILED);
    expect(options).not.toContain(TaskStatus.GRANT_PENDING);
    expect(options).not.toContain(TaskStatus.OUT_OF_CREDITS);
  });
});
