import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mockCoworkerOption } from "@/test-fixtures/coworker";

import { TaskAssigneePicker } from "./task-assignee-picker";

const options = [
  mockCoworkerOption({
    id: "coworker-1",
    slug: "soko",
    name: "Soko",
  }),
  mockCoworkerOption({
    id: "coworker-2",
    slug: "elena",
    name: "Elena",
  }),
  mockCoworkerOption({
    id: "user-1",
    slug: "bob",
    name: "Bob",
    kind: "user",
    vendor: {
      id: "workspace-members",
      name: "Members",
      slug: "workspace-members",
      logos: { light: null, dark: null },
    },
  }),
];

const labels = {
  ariaLabel: "Coworker",
  unassigned: "Unassigned",
  searchPlaceholder: "Search assignees…",
  noResults: "No matches",
  agentsGroupLabel: "Coworker",
};

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof TaskAssigneePicker>> = {},
) {
  const onSelect = vi.fn();
  render(
    <TaskAssigneePicker
      value="coworker-1"
      options={options}
      labels={labels}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { onSelect };
}

describe("TaskAssigneePicker", () => {
  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("opens and lists unassigned plus grouped options", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Coworker" }));

    const listbox = screen.getByRole("listbox");
    const optionNames = within(listbox)
      .getAllByRole("option")
      .map(
        (option) =>
          option.querySelector<HTMLElement>(".flex-1")?.textContent ??
          option.textContent,
      );
    expect(optionNames).toEqual(["Unassigned", "Bob", "Soko", "Elena"]);
    expect(
      within(listbox).getByRole("option", { name: /Soko/ }),
    ).toHaveAttribute("data-current", "true");
  });

  it("selects an option and closes the list", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Coworker" }));
    await user.click(screen.getByRole("option", { name: "Elena" }));

    expect(onSelect).toHaveBeenCalledWith("coworker-2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("selects unassigned from the list", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Coworker" }));
    await user.click(screen.getByRole("option", { name: "Unassigned" }));

    expect(onSelect).toHaveBeenCalledWith("");
  });

  it("renders disabled options", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker({
      isOptionDisabled: (option) =>
        option === "unassigned" || option.kind === "user",
    });

    await user.click(screen.getByRole("combobox", { name: "Coworker" }));

    expect(screen.getByRole("option", { name: "Unassigned" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("option", { name: "Bob" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("option", { name: "Soko" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.click(screen.getByRole("option", { name: "Elena" }));
    expect(onSelect).toHaveBeenCalledWith("coworker-2");
  });

  it("shows the unassigned label when no assignee is selected", () => {
    renderPicker({ value: "" });

    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.queryByAltText("Serviceplan")).not.toBeInTheDocument();
  });

  it("shows the vendor mark beside a compact dropdown trigger", () => {
    renderPicker({ value: "coworker-2" });

    expect(screen.getByText("Elena")).toBeInTheDocument();
    expect(screen.getAllByAltText("Serviceplan").length).toBeGreaterThan(0);

    const trigger = screen.getByRole("combobox", { name: "Coworker" });
    expect(trigger).not.toHaveTextContent("Elena");
    expect(trigger.className).toMatch(/\bsize-8\b/);
    expect(trigger.className).not.toMatch(/\bw-full\b/);

    const name = screen.getByText("Elena");
    const vendor = screen.getAllByAltText("Serviceplan")[0];
    expect(
      name.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      trigger.compareDocumentPosition(vendor) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
