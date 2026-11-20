import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  TASKS_LOADING_DEFAULT_LABELS,
  TasksLoadingView,
} from "@/app/tasks/components/tasks-loading-view";
import { TASKS_BOARD_MIN_HEIGHT_CLASS } from "@/app/tasks/constants";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

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

  it("draws the board's toolbar with its translated labels in the same row, so it wraps where the board's does", () => {
    const { container } = render(
      <TasksLoadingView labels={TASKS_LOADING_DEFAULT_LABELS} />,
    );

    const row = container.querySelector("[data-tasks-toolbar-row]");
    expect(row).toBeTruthy();
    // The real view switcher, in the reader's language, but not usable yet.
    const switcher = container.querySelector(
      '[inert] [aria-label="viewLabel"]',
    );
    expect(switcher).toBeTruthy();
    expect(switcher).toHaveTextContent("all");
    expect(switcher).toHaveTextContent("assignedToMe");
    // Search, Filters (its translated label) and view options wrap together.
    const search = screen.getByTestId("tasks-search-skeleton");
    expect(search).toHaveClass("h-10", "@2xl/page-toolbar:h-8");
    const actions = search.closest(".ms-auto");
    expect(actions).toHaveTextContent("title");
    expect(actions).toContainElement(
      screen.getByRole("button", { name: "View options" }),
    );
  });

  it("reserves the height the board's toolbar last had, so active filter chips do not drop the board", () => {
    const { container } = render(
      <TasksLoadingView
        labels={TASKS_LOADING_DEFAULT_LABELS}
        toolbarMinHeight={96}
      />,
    );

    expect(
      container.querySelector("[data-tasks-toolbar-row]")?.parentElement,
    ).toHaveStyle({ minHeight: "96px" });
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
