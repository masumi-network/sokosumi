import { describe, expect, it } from "vitest";
import { getTasksEmptyStateGuideContent } from "@/app/tasks/components/tasks-empty-state-overlay";

const labels = {
  title: "Welcome",
  description: "Create your first task",
  getStartedTitle: "Ready to start",
  getStartedDescription: "Open the guide and create a task",
  getStartedButton: "Get started",
  next: "Next",
  back: "Back",
  addTaskHint: "Add a task first",
  elenaAvatarAlt: "Elena avatar",
};

describe("getTasksEmptyStateGuideContent", () => {
  it("returns add-task guide content for the first step", () => {
    expect(getTasksEmptyStateGuideContent("addTask", labels)).toEqual({
      title: labels.title,
      description: labels.description,
      hint: labels.addTaskHint,
    });
  });

  it("returns get-started guide content for the final step", () => {
    expect(getTasksEmptyStateGuideContent("getStarted", labels)).toEqual({
      title: labels.getStartedTitle,
      description: labels.getStartedDescription,
      hint: "",
    });
  });
});
