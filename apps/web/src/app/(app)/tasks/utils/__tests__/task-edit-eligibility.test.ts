import { describe, expect, it } from "vitest";

import { isTaskEditPageAllowed } from "@/app/tasks/utils/task-edit-eligibility";
import { TaskStatus } from "@/lib/clients/generated/core";

describe("isTaskEditPageAllowed", () => {
  it("allows editable tasks", () => {
    expect(
      isTaskEditPageAllowed({
        status: TaskStatus.DRAFT,
      }),
    ).toBe(true);
  });

  it("disallows non-editable statuses", () => {
    expect(
      isTaskEditPageAllowed({
        status: TaskStatus.RUNNING,
      }),
    ).toBe(false);
  });
});
