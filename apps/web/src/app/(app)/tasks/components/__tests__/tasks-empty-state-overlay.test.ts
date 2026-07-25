import { describe, expect, it } from "vitest";
import { getTasksEmptyStateGuideContent } from "@/app/tasks/components/tasks-empty-state-overlay";

const labels = {
  title: "Welcome",
  description: "Create your first task",
  chatTitle: "Use chat",
  chatDescription: "Ask Elena to draft a research task",
  getStartedTitle: "Ready to start",
  getStartedDescription: "Open the guide and create a task",
  getStartedButton: "Get started",
  next: "Next",
  back: "Back",
  addTaskHint: "Add a task first",
  chatHint: "Use chat next",
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

  it("returns chat guide content for the second step", () => {
    expect(getTasksEmptyStateGuideContent("chat", labels)).toEqual({
      title: labels.chatTitle,
      description: labels.chatDescription,
      hint: labels.chatHint,
    });
  });
});
