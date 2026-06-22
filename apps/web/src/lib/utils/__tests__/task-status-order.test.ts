import { TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { TASK_STATUS_DISPLAY_ORDER } from "@/lib/utils/task-status-order";

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
