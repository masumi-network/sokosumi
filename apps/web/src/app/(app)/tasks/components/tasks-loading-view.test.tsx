import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TasksLoadingView } from "@/app/tasks/components/tasks-loading-view";
import {
  TASKS_BOARD_MIN_HEIGHT_CLASS,
  TASKS_TOOLBAR_ROW_CLASS,
} from "@/app/tasks/constants";

const TASKS_LOADING_DEFAULT_LABELS = {
  columns: {
    backlog: "Backlog",
    todo: "Todo",
    "in-progress": "In progress",
    "input-required": "Input required",
    done: "Done",
  },
};

describe("TasksLoadingView", () => {
  it("renders board columns by default", () => {
    render(<TasksLoadingView labels={TASKS_LOADING_DEFAULT_LABELS} />);

    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("Todo")).toBeInTheDocument();
  });

  it("draws the toolbar it gets in the board's toolbar row", () => {
    render(
      <TasksLoadingView
        labels={TASKS_LOADING_DEFAULT_LABELS}
        toolbar={<button type="button">View options</button>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "View options" }).parentElement,
    ).toHaveClass(TASKS_TOOLBAR_ROW_CLASS);
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
