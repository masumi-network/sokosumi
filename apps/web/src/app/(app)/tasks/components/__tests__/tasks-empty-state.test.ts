import { describe, expect, it } from "vitest";
import { shouldShowTasksEmptyStateOverlay } from "@/app/tasks/components/tasks-empty-state";

describe("shouldShowTasksEmptyStateOverlay", () => {
  it("returns true only for empty tasks tab in board view", () => {
    expect(
      shouldShowTasksEmptyStateOverlay({
        activeTab: "tasks",
        taskCount: 0,
        viewMode: "board",
        guideCompleted: false,
      }),
    ).toBe(true);
  });

  it("returns false when there are existing tasks", () => {
    expect(
      shouldShowTasksEmptyStateOverlay({
        activeTab: "tasks",
        taskCount: 1,
        viewMode: "board",
        guideCompleted: false,
      }),
    ).toBe(false);
  });

  it("returns false when jobs tab is active", () => {
    expect(
      shouldShowTasksEmptyStateOverlay({
        activeTab: "jobs",
        taskCount: 0,
        viewMode: "board",
        guideCompleted: false,
      }),
    ).toBe(false);
  });

  it("returns false in list view", () => {
    expect(
      shouldShowTasksEmptyStateOverlay({
        activeTab: "tasks",
        taskCount: 0,
        viewMode: "list",
        guideCompleted: false,
      }),
    ).toBe(false);
  });

  it("returns false when the guide is completed", () => {
    expect(
      shouldShowTasksEmptyStateOverlay({
        activeTab: "tasks",
        taskCount: 0,
        viewMode: "board",
        guideCompleted: true,
      }),
    ).toBe(false);
  });
});
