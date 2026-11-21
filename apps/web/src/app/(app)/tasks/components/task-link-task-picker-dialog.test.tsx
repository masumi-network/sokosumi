import { render, screen, waitFor } from "@testing-library/react";
import { ListTree } from "lucide-react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TaskLinkTaskPickerDialog } from "./task-link-task-picker-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getTasks: async () => ({ data: [], meta: {} }) },
}));

const option = {
  id: "move-under",
  label: "Move under",
  title: "Move under a task",
  description: "Pick the task this one goes under.",
  icon: ListTree,
};

function picker(open: boolean, onCloseAutoFocus: (event: Event) => void) {
  return (
    <>
      <button type="button">Actions</button>
      <TaskLinkTaskPickerDialog
        taskId="task-1"
        open={open}
        onOpenChange={() => {}}
        selectedOption={open ? option : null}
        isLinkPending={false}
        onSelectTask={() => {}}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </>
  );
}

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("TaskLinkTaskPickerDialog", () => {
  it("lets the caller choose where focus goes when it closes", async () => {
    // The menu item that opened it is gone, so Radix's default finds nothing.
    const focusActions = (event: Event) => {
      event.preventDefault();
      screen.getByRole("button", { name: "Actions", hidden: true }).focus();
    };
    const { rerender } = render(picker(true, focusActions));
    await screen.findByRole("dialog");

    rerender(picker(false, focusActions));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus(),
    );
  });

  it("shows the picker's title and what picking does", async () => {
    render(picker(true, () => {}));

    const heading = await screen.findByRole("heading", {
      name: "Move under a task",
    });
    expect(heading.closest(".sr-only")).toBeNull();
    expect(
      screen
        .getByText("Pick the task this one goes under.")
        .closest(".sr-only"),
    ).toBeNull();
  });
});
