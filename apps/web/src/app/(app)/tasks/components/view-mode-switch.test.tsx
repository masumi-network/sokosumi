import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ViewModeSwitch } from "./view-mode-switch";

const labels = {
  button: "View options",
  layout: "Layout",
  list: "List",
  board: "Board",
  density: "Density",
  normal: "Normal",
  compact: "Compact",
  sortBy: "Sort by",
  sortOptions: {
    updatedAt: "Last updated",
    createdAt: "Newest",
    priority: "Priority",
    dueOn: "Due date",
  },
  showSubtasks: "Show open sub-tasks",
};

describe("ViewModeSwitch sort", () => {
  it("lists every order in the menu and picks one in one click", async () => {
    const onSortChange = vi.fn();
    render(
      <ViewModeSwitch
        value="board"
        onChange={vi.fn()}
        density="normal"
        onDensityChange={vi.fn()}
        labels={labels}
        sort="updatedAt"
        onSortChange={onSortChange}
        showSubtasks={false}
        onShowSubtasksChange={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "View options" }));
    const group = screen.getByRole("radiogroup", { name: "Sort by" });

    expect(screen.getByRole("radio", { name: "Last updated" })).toBeChecked();
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(4);

    await userEvent.click(screen.getByRole("radio", { name: "Priority" }));

    expect(onSortChange).toHaveBeenCalledExactlyOnceWith("priority");
  });
});
