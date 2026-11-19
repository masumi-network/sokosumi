import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommandDialog, CommandInput } from "./command";

describe("CommandDialog", () => {
  // Its screen-reader title used to render outside the dialog, so every page
  // carried a stray "Search" or "..." heading while the dialog was closed.
  it("puts no heading or description on the page while closed", () => {
    render(
      <CommandDialog
        open={false}
        title="Link a task"
        description="Choose a task to link."
      >
        <CommandInput />
      </CommandDialog>,
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByText("Choose a task to link.")).not.toBeInTheDocument();
  });

  it("names and describes the dialog while open", () => {
    render(
      <CommandDialog open title="Link a task" description="Choose a task to link.">
        <CommandInput />
      </CommandDialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Link a task" });
    expect(dialog).toHaveAccessibleDescription("Choose a task to link.");
  });
});
