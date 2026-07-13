import { describe, expect, it } from "vitest";

import { TASK_STATUS } from "@/app/tasks/components/task-detail-api-types";
import { isTaskEditPageAllowed } from "@/app/tasks/utils/task-edit-eligibility";

describe("isTaskEditPageAllowed", () => {
  it("allows editable tasks", () => {
    expect(
      isTaskEditPageAllowed({
        status: TASK_STATUS.DRAFT,
      }),
    ).toBe(true);
  });

  it("disallows non-editable statuses", () => {
    expect(
      isTaskEditPageAllowed({
        status: TASK_STATUS.RUNNING,
      }),
    ).toBe(false);
  });
});
