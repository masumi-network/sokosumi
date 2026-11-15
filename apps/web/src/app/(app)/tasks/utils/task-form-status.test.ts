import { TaskStatus } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { resolveStatusForAssigneeAndRunAt } from "./task-form-status";

describe("resolveStatusForAssigneeAndRunAt", () => {
  it.each([
    { isAgent: true, hasRunAt: true, status: TaskStatus.QUEUED },
    { isAgent: true, hasRunAt: false, status: TaskStatus.READY },
    { isAgent: false, hasRunAt: true, status: TaskStatus.DRAFT },
    { isAgent: false, hasRunAt: false, status: TaskStatus.DRAFT },
  ])(
    "agent $isAgent with Run at $hasRunAt starts $status",
    ({ isAgent, hasRunAt, status }) => {
      expect(resolveStatusForAssigneeAndRunAt({ isAgent, hasRunAt })).toBe(
        status,
      );
    },
  );
});
