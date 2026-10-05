import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";

import { TaskListView } from "./task-list-view";

vi.mock("./task-card", () => ({
  TaskCard: () => <div data-testid="task-card" />,
}));
vi.mock("./task-list-item", () => ({
  TaskListItem: () => <div data-testid="task-list-item" />,
}));

describe("TaskListView", () => {
  it("renders the board card below md and the row from md up", () => {
    render(
      <TaskListView
        tasks={[{ id: "t1" } as TaskWithCoworker]}
        labels={{ emptyList: "none" }}
      />,
    );

    expect(screen.getByTestId("task-card").parentElement).toHaveClass(
      "md:hidden",
    );
    expect(screen.getByTestId("task-list-item").parentElement).toHaveClass(
      "hidden",
      "md:block",
    );
  });
});
