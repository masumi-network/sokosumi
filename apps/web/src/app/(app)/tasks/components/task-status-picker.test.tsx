import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getToneStyle } from "@/components/ui/status-marker";
import { TaskStatus } from "@/lib/clients/generated/core";
import { getTaskStatusMarker } from "./task-status-badge";

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

  /**
   * A menu row paints no fill, so the glyph reads with the word and takes the
   * same colour. `FAILED` is the status where that matters: its badge paints a
   * solid red fill and labels itself near-white, so a glyph taking the badge's
   * own mark colour would be near-white on a near-white popover.
   *
   * `labelOnSurface` rather than `onSurface` because cmdk paints the selected
   * row --accent, and the solid red measures 2.53:1 there in dark.
   */
  it("draws the Failed menu glyph in the readable label colour", async () => {
    const user = userEvent.setup();
    renderPicker({ options: [TaskStatus.FAILED] });

    await user.click(screen.getByRole("combobox", { name: "Status" }));

    const row = screen.getByRole("option", { name: /Failed/ });
    const style = getToneStyle(getTaskStatusMarker(TaskStatus.FAILED).tone);
    expect(row.querySelector("svg")).toHaveClass(style.labelOnSurface);
    expect(style.labelOnSurface).not.toBe(style.mark);
    expect(style.labelOnSurface).not.toBe(style.onSurface);
  });

  /**
   * The regression this test exists for: the menu briefly drew a dot instead
   * of the glyph. Five statuses share the `blocked` hue, so the marker column
   * became five identical dots and the word was the only thing left telling
   * them apart, which is the single-channel failure SC 1.4.1 is about.
   */
  it("gives every same-hue option its own glyph", async () => {
    const user = userEvent.setup();
    const blocked = [
      TaskStatus.GRANT_PENDING,
      TaskStatus.INPUT_REQUIRED,
      TaskStatus.APPROVAL_REQUIRED,
      TaskStatus.AUTHENTICATION_REQUIRED,
      TaskStatus.OUT_OF_CREDITS,
    ];
    renderPicker({ options: blocked });

    await user.click(screen.getByRole("combobox", { name: "Status" }));

    const paths = screen.getAllByRole("option").map((row) => {
      const svg = row.querySelector("svg");
      expect(svg, `${row.textContent} has no glyph`).not.toBeNull();
      return svg?.innerHTML ?? "";
    });

    // The picker always keeps the current value in the list, so there is one
    // row more than the five asked for. Every row still needs its own glyph.
    expect(paths.length).toBeGreaterThanOrEqual(blocked.length);
    expect(new Set(paths).size).toBe(paths.length);
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

/**
 * COMPLETED, not RUNNING. The running marker is lucide's `LoaderCircle`, which
 * is the component the pending spinner also uses, and it already spins, so on
 * that one status the two branches render byte-identical markup and every
 * assertion below would hold with the swap deleted.
 */
describe("TaskStatusPicker pending spinner", () => {
  const ROLE = getToneStyle(getTaskStatusMarker(TaskStatus.COMPLETED).tone);

  /** The glyph is the only element inside the pill that carries a role colour. */
  function glyphOfTrigger(): SVGElement {
    const glyph = screen
      .getByRole("combobox", { name: "Status" })
      .querySelector("svg");
    if (!glyph) throw new Error("the pill rendered no glyph");
    return glyph;
  }

  it("marks the resting pill with the role glyph, and does not spin it", () => {
    renderPicker({ value: TaskStatus.COMPLETED });

    const glyph = glyphOfTrigger();

    expect(glyph).toHaveClass(ROLE.mark);
    expect(glyph).not.toHaveClass("animate-spin");
  });

  /**
   * The spinner replaces the glyph rather than joining it, so it has to occupy
   * the same box, carry the same colour and hold the same stroke. A lighter
   * 2px stroke erodes on the dark fills, which is why StatusMarker sets 2.25.
   */
  it("hands the pending spinner the glyph's box, colour and stroke", () => {
    renderPicker({ value: TaskStatus.COMPLETED, isPending: true });

    const spinner = glyphOfTrigger();

    expect(spinner).toHaveClass(
      "size-3.5",
      "shrink-0",
      "animate-spin",
      ROLE.mark,
    );
    expect(spinner).toHaveAttribute("stroke-width", "2.25");
  });

  /** The spin is decoration; it stops when the reader asks for less motion. */
  it("stops the spinner under prefers-reduced-motion", () => {
    renderPicker({ value: TaskStatus.COMPLETED, isPending: true });

    expect(glyphOfTrigger()).toHaveClass("motion-reduce:animate-none");
  });
});
