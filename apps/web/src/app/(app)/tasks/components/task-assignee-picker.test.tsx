import { render, screen, waitFor, within } from "@testing-library/react";
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
  unavailableAssignee: "Unavailable assignee",
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

    await user.click(screen.getByRole("combobox", { name: "Coworker: Soko" }));

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

    await user.click(screen.getByRole("combobox", { name: "Coworker: Soko" }));
    await user.click(screen.getByRole("option", { name: "Elena" }));

    expect(onSelect).toHaveBeenCalledWith("coworker-2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("selects unassigned from the list", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Coworker: Soko" }));
    await user.click(screen.getByRole("option", { name: "Unassigned" }));

    expect(onSelect).toHaveBeenCalledWith("");
  });

  it("renders disabled options", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker({
      isOptionDisabled: (option) =>
        option === "unassigned" || option.kind === "user",
    });

    await user.click(screen.getByRole("combobox", { name: "Coworker: Soko" }));

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

    const trigger = screen.getByRole("combobox", {
      name: "Coworker: Unassigned",
    });
    expect(trigger).toHaveTextContent("Unassigned");
    // Single-line labels need an explicit floor; text-sm alone is under 24px.
    expect(trigger.className).toMatch(/\bmin-h-6\b/);
    expect(screen.queryByAltText("Serviceplan")).not.toBeInTheDocument();
  });

  it("keeps a missing saved assignee labeled instead of unassigned", () => {
    renderPicker({ value: "gone-coworker", options: [] });

    const trigger = screen.getByRole("combobox", {
      name: "Coworker: Unavailable assignee",
    });
    expect(trigger).toHaveTextContent("Unavailable assignee");
    expect(trigger).not.toHaveTextContent("Unassigned");
  });

  it("keeps the assignee trigger compact next to the vendor mark", () => {
    renderPicker({ value: "coworker-2" });

    const trigger = screen.getByRole("combobox", { name: "Coworker: Elena" });
    expect(trigger).toHaveTextContent("Elena");
    expect(trigger.className).toMatch(/\binline-flex\b/);
    expect(trigger.className).not.toMatch(/(?:^|\s)w-full(?:\s|$)/);
    expect(screen.getAllByAltText("Serviceplan").length).toBeGreaterThan(0);

    const vendor = screen.getAllByAltText("Serviceplan")[0];
    expect(
      trigger.compareDocumentPosition(vendor) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the option list scrollable under touch", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Coworker: Soko" }));

    const listbox = screen.getByRole("listbox");
    expect(listbox.className).toContain("touch-pan-y");
    expect(listbox.className).toContain("overflow-y-auto");
  });

  it("portals the list into the owning dialog so scroll stays allowlisted", async () => {
    const user = userEvent.setup();
    const dialog = document.createElement("div");
    dialog.setAttribute("data-slot", "dialog-content");
    dialog.setAttribute("data-testid", "assignee-dialog-host");
    document.body.append(dialog);

    try {
      const onSelect = vi.fn();
      render(
        <TaskAssigneePicker
          value="coworker-1"
          options={options}
          labels={labels}
          onSelect={onSelect}
        />,
        { container: dialog },
      );

      await user.click(
        screen.getByRole("combobox", { name: "Coworker: Soko" }),
      );

      await waitFor(() => {
        expect(
          dialog.querySelector('[data-slot="popover-content"]'),
        ).toBeTruthy();
      });

      expect(
        document.body.querySelector(
          ':scope > [data-radix-popper-content-wrapper] [data-slot="popover-content"]',
        ),
      ).toBeNull();
      expect(dialog.contains(screen.getByRole("listbox"))).toBe(true);
    } finally {
      dialog.remove();
    }
  });
});
