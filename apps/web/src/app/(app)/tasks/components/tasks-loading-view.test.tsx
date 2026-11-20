import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  TASKS_LOADING_DEFAULT_LABELS,
  TasksLoadingView,
} from "@/app/tasks/components/tasks-loading-view";
import { TASKS_BOARD_MIN_HEIGHT_CLASS } from "@/app/tasks/constants";
import { SEGMENTED_CONTROL_CLASS_NAME } from "@/components/ui/segmented-control-classes";

describe("TasksLoadingView", () => {
  it("renders board columns by default", () => {
    render(<TasksLoadingView labels={TASKS_LOADING_DEFAULT_LABELS} />);

    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("Todo")).toBeInTheDocument();
  });

  it("shows no column counts before the board has loaded", () => {
    render(<TasksLoadingView labels={TASKS_LOADING_DEFAULT_LABELS} />);

    expect(screen.queryByText("0")).not.toBeInTheDocument();
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

  it("renders a rounded list shell matching TaskListView: tinted below md, one bordered surface from md up", () => {
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
    expect(listShell).toHaveClass("rounded-xl", "p-2", "md:border", "md:p-0");
    expect(listShell).not.toHaveClass("border");
    expect(listShell).not.toHaveClass("-mx-4");
  });

  it("draws the board toolbar's rows at their real heights, so the board does not drop when it loads", () => {
    const { container } = render(
      <TasksLoadingView labels={TASKS_LOADING_DEFAULT_LABELS} />,
    );

    const toolbar = container.querySelector(".\\@container\\/page-toolbar");
    expect(toolbar).toBeTruthy();
    // The view switcher: a 40px segmented control of four 32px items.
    const switcher = screen.getByTestId("tasks-view-switcher-skeleton");
    expect(switcher).toHaveClass(...SEGMENTED_CONTROL_CLASS_NAME.split(" "));
    expect(switcher.children).toHaveLength(4);
    for (const item of switcher.children) expect(item).toHaveClass("h-8");
    // Search, Filters and view options wrap together under it, as on the board.
    const search = screen.getByTestId("tasks-search-skeleton");
    expect(search).toHaveClass("h-10", "@2xl/page-toolbar:h-8");
    expect(search.closest(".ms-auto")).toContainElement(
      screen.getByRole("button", { name: "View options" }),
    );
  });

  it("gives the board the height it has once loaded", () => {
    const { container } = render(
      <TasksLoadingView labels={TASKS_LOADING_DEFAULT_LABELS} />,
    );

    expect(container.querySelector(".overflow-x-auto")).toHaveClass(
      TASKS_BOARD_MIN_HEIGHT_CLASS,
    );
  });

  it("renders card and row placeholders for every list item, like TaskListView", () => {
    render(
      <TasksLoadingView
        viewMode="list"
        labels={TASKS_LOADING_DEFAULT_LABELS}
      />,
    );

    const cards = screen.getAllByTestId("task-card-skeleton");
    const rows = screen.getAllByTestId("task-row-skeleton");
    expect(cards.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(cards.length);
    for (const card of cards) {
      expect(card.parentElement).toHaveClass("md:hidden");
    }
  });
});
