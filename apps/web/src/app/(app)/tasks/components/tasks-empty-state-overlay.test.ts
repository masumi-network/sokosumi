import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getTasksEmptyStateGuideContent,
  resolveMobileGuideHintPosition,
  selectTasksEmptyStateAddTaskTarget,
} from "@/app/tasks/components/tasks-empty-state-overlay";

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

function mockLayoutBox(
  element: HTMLElement,
  box: Pick<DOMRect, "width" | "height" | "top" | "left">,
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: box.left,
    y: box.top,
    top: box.top,
    left: box.left,
    bottom: box.top + box.height,
    right: box.left + box.width,
    width: box.width,
    height: box.height,
    toJSON() {
      return this;
    },
  });
}

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

describe("selectTasksEmptyStateAddTaskTarget", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("skips a zero-size header and selects the mobile create FAB", () => {
    const header = document.createElement("button");
    header.setAttribute("data-tasks-add-task-header-anchor", "");
    mockLayoutBox(header, { width: 0, height: 0, top: 0, left: 0 });

    const fabShell = document.createElement("div");
    fabShell.setAttribute("data-list-mobile-create-fab", "");
    const fabButton = document.createElement("button");
    mockLayoutBox(fabButton, { width: 56, height: 56, top: 640, left: 300 });
    fabShell.append(fabButton);

    document.body.append(header, fabShell);

    expect(selectTasksEmptyStateAddTaskTarget("mobile")).toBe(fabButton);
  });

  it("prefers a visible column add control over the FAB", () => {
    const column = document.createElement("button");
    column.setAttribute("data-tasks-add-task-column-anchor", "");
    mockLayoutBox(column, { width: 120, height: 32, top: 200, left: 24 });

    const fabShell = document.createElement("div");
    fabShell.setAttribute("data-list-mobile-create-fab", "");
    const fabButton = document.createElement("button");
    mockLayoutBox(fabButton, { width: 56, height: 56, top: 640, left: 300 });
    fabShell.append(fabButton);

    document.body.append(column, fabShell);

    expect(selectTasksEmptyStateAddTaskTarget("mobile")).toBe(column);
  });

  it("does not use the FAB on desktop when the header is visible", () => {
    const header = document.createElement("button");
    header.setAttribute("data-tasks-add-task-header-anchor", "");
    mockLayoutBox(header, { width: 96, height: 32, top: 16, left: 800 });

    const fabShell = document.createElement("div");
    fabShell.setAttribute("data-list-mobile-create-fab", "");
    const fabButton = document.createElement("button");
    mockLayoutBox(fabButton, { width: 56, height: 56, top: 640, left: 300 });
    fabShell.append(fabButton);

    document.body.append(header, fabShell);

    expect(selectTasksEmptyStateAddTaskTarget("desktop")).toBe(header);
  });
});

describe("resolveMobileGuideHintPosition", () => {
  it("places the hint left of a right-aligned FAB so it stays in viewport", () => {
    const start = { x: 195, y: 320 };
    const end = { x: 346, y: 640 }; // FAB center near right edge of 390px phone
    const label = resolveMobileGuideHintPosition(end, start, 390);

    expect(label.x).toBeLessThan(end.x);
    expect(label.x + 140).toBeLessThanOrEqual(390 - 12);
    expect(label.x).toBeGreaterThanOrEqual(12);
    expect(label.y).toBe(end.y - 48);
  });

  it("clamps above-target hints that would overflow the right edge", () => {
    const start = { x: 195, y: 320 };
    const end = { x: 360, y: 80 };
    const label = resolveMobileGuideHintPosition(end, start, 390);

    expect(label.x).toBe(390 - 140 - 12);
    expect(label.y).toBe(end.y + 60);
  });
});
