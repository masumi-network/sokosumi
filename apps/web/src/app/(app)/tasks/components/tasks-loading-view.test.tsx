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

  it("omits desktop create buttons and pads for the mobile FAB", () => {
    const { container } = render(
      <TasksLoadingView labels={TASKS_LOADING_DEFAULT_LABELS} />,
    );

    const headerCreate = container.querySelector(
      "[data-tasks-add-task-header-anchor]",
    );
    expect(headerCreate).toBeNull();
    expect(
      screen.queryByRole("button", { name: "New Task" }),
    ).not.toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain(
      "pb-[calc(3.5rem+1rem)]",
    );
    expect(container.firstElementChild?.className).toContain("md:pb-0");

    const boardScrollport = container.querySelector(".overflow-y-auto");
    expect(boardScrollport?.className).toContain("pb-[calc(3.5rem+1rem)]");
    expect(boardScrollport?.className).toContain("md:pb-2");
  });

  it("renders a rounded borderless list shell matching TaskListView", () => {
    const { container } = render(
      <TasksLoadingView
        viewMode="list"
        labels={TASKS_LOADING_DEFAULT_LABELS}
      />,
    );

    const listShell = container.querySelector(
      ".bg-card-background.overflow-hidden",
    );
    expect(listShell).toBeTruthy();
    expect(listShell).toHaveClass("rounded-xl", "p-2");
    expect(listShell).not.toHaveClass("border", "md:border", "-mx-4");
  });
});
