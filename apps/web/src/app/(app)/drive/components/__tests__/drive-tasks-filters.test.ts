import { describe, expect, it } from "vitest";
import { buildDriveTasksFilterParams } from "../drive-tasks-filters";

describe("buildDriveTasksFilterParams", () => {
  it("clears project and task drill-down when assignee changes", () => {
    const params = new URLSearchParams(
      "view=tasks&assigneeId=cow-1&projectId=proj-1&taskId=task-1",
    );

    const next = buildDriveTasksFilterParams(params, "assigneeId", "cow-2");

    expect(next.get("assigneeId")).toBe("cow-2");
    expect(next.has("projectId")).toBe(false);
    expect(next.has("taskId")).toBe(false);
  });

  it("clears task drill-down when project changes", () => {
    const params = new URLSearchParams(
      "view=tasks&projectId=proj-1&taskId=task-1",
    );

    const next = buildDriveTasksFilterParams(params, "projectId", "proj-2");

    expect(next.get("projectId")).toBe("proj-2");
    expect(next.has("taskId")).toBe(false);
  });

  it("clears assignee when set to all", () => {
    const params = new URLSearchParams(
      "view=tasks&assigneeId=cow-1&projectId=proj-1&taskId=task-1",
    );

    const next = buildDriveTasksFilterParams(params, "assigneeId", null);

    expect(next.has("assigneeId")).toBe(false);
    expect(next.has("projectId")).toBe(false);
    expect(next.has("taskId")).toBe(false);
  });
});
