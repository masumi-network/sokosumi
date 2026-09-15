import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TaskStatus } from "@/lib/clients/generated/core";

import { TaskStatusPicker } from "./task-status-picker";

const statusLabels = {
  [TaskStatus.DRAFT]: "Draft",
  [TaskStatus.QUEUED]: "Queued",
  [TaskStatus.READY]: "Ready",
  [TaskStatus.GRANT_PENDING]: "Grant pending",
  [TaskStatus.INPUT_REQUIRED]: "Input required",
  [TaskStatus.APPROVAL_REQUIRED]: "Approval required",
  [TaskStatus.AUTHENTICATION_REQUIRED]: "Authentication required",
  [TaskStatus.OUT_OF_CREDITS]: "Paused: credits needed",
  [TaskStatus.CREDITS_TOPPED_UP]: "Credits topped up",
  [TaskStatus.RUNNING]: "Running",
  [TaskStatus.AWAITING_EXTERNAL]: "Awaiting external",
  [TaskStatus.COMPLETED]: "Completed",
  [TaskStatus.FAILED]: "Failed",
  [TaskStatus.CANCELED]: "Canceled",
};

const labels = {
  statusLabels,
  ariaLabel: "Status",
  searchPlaceholder: "Change status…",
  noResults: "No status matches",
};

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof TaskStatusPicker>> = {},
) {
  const onSelect = vi.fn();
  render(
    <TaskStatusPicker
      value={TaskStatus.READY}
      options={[
        TaskStatus.DRAFT,
        TaskStatus.RUNNING,
        TaskStatus.COMPLETED,
        TaskStatus.CANCELED,
      ]}
      labels={labels}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { onSelect };
}

describe("TaskStatusPicker", () => {
  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("lists the current status among the selectable ones in display order, with the current one checked", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Status" }));

    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Draft1",
      "Ready2",
      "Running3",
      "Completed4",
      "Canceled5",
    ]);
    expect(options[1]).toHaveAttribute("data-current", "true");
    expect(options[0]).not.toHaveAttribute("data-current");
    expect(
      screen.queryByRole("option", { name: /Input required/ }),
    ).not.toBeInTheDocument();
  });

  it("picks an option with its number key while the list is open", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.keyboard("4");

    expect(onSelect).toHaveBeenCalledWith(TaskStatus.COMPLETED);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("filters the list by typing", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.type(screen.getByPlaceholderText("Change status…"), "can");

    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    expect(
      within(listbox).getByRole("option", { name: /Canceled/ }),
    ).toBeInTheDocument();
  });

  it("types digits into the filter instead of picking once a filter is active", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.type(screen.getByPlaceholderText("Change status…"), "c4");

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Change status…")).toHaveValue("c4");
  });

  it("ignores Shift+S and S while a change is pending", async () => {
    const user = userEvent.setup();
    renderPicker({ openShortcutKey: "s", isPending: true });

    await user.keyboard("s");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens with the S key when nothing editable is focused", async () => {
    const user = userEvent.setup();
    renderPicker({ openShortcutKey: "s" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.keyboard("{Shift>}S{/Shift}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.keyboard("s");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("ignores the S key while typing in a text field", async () => {
    const user = userEvent.setup();
    render(<input aria-label="Notes" />);
    renderPicker({ openShortcutKey: "s" });

    await user.click(screen.getByRole("textbox", { name: "Notes" }));
    await user.keyboard("s");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders disabled options without a number key", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker({
      isOptionDisabled: (status) => status === TaskStatus.RUNNING,
    });

    await user.click(screen.getByRole("combobox", { name: "Status" }));

    const running = screen.getByRole("option", { name: /Running/ });
    expect(running).toHaveAttribute("aria-disabled", "true");
    expect(running.textContent).toBe("Running");
    // The digits skip the disabled row, so 3 is Completed.
    await user.keyboard("3");
    expect(onSelect).toHaveBeenCalledWith(TaskStatus.COMPLETED);
  });
});
