import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  TASKS_LOADING_DEFAULT_LABELS,
  TasksLoadingView,
} from "@/app/tasks/components/tasks-loading-view";

describe("TasksLoadingView", () => {
  it("renders board columns by default", () => {
    render(<TasksLoadingView labels={TASKS_LOADING_DEFAULT_LABELS} />);

    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("Todo")).toBeInTheDocument();
  });

  it("renders list shell matching TaskListView edge-to-edge classes", () => {
    const { container } = render(
      <TasksLoadingView
        viewMode="list"
        labels={TASKS_LOADING_DEFAULT_LABELS}
      />,
    );

    const listShell = container.querySelector(
      ".bg-muted\\/30.border-border\\/50",
    );
    expect(listShell).toBeTruthy();
    expect(listShell?.className).toContain("-mx-6");
    expect(listShell?.className).toContain("rounded-none");
    expect(listShell?.className).toContain("border-0");
    expect(listShell?.className).toContain("md:mx-0");
    expect(listShell?.className).toContain("md:rounded-xl");
    expect(listShell?.className).toContain("md:border");
    expect(listShell?.className).not.toContain("rounded-xl border");
  });
});
