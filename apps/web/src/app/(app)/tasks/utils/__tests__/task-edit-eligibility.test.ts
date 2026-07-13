import { describe, expect, it } from "vitest";

import { TASK_STATUS } from "@/app/tasks/components/task-detail-api-types";
import { isTaskEditPageAllowed } from "@/app/tasks/utils/task-edit-eligibility";

describe("isTaskEditPageAllowed", () => {
  it("allows editable tasks without vendor approval pending", () => {
    expect(
      isTaskEditPageAllowed({
        status: TASK_STATUS.DRAFT,
        awaitingVendorApproval: false,
      }),
    ).toBe(true);
  });

  it("disallows tasks awaiting vendor approval", () => {
    expect(
      isTaskEditPageAllowed({
        status: TASK_STATUS.DRAFT,
        awaitingVendorApproval: true,
      }),
    ).toBe(false);
  });

  it("disallows non-editable statuses", () => {
    expect(
      isTaskEditPageAllowed({
        status: TASK_STATUS.RUNNING,
      }),
    ).toBe(false);
  });
});
