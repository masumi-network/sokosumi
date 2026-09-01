import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Folder } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import {
  FILTER_DROPDOWN_OPTION_LABEL_CLASS,
  FilterDropdownMenu,
} from "@/components/common/filter-dropdown-menu";

const filterDropdownMenuSource = readFileSync(
  join(import.meta.dirname, "./filter-dropdown-menu.tsx"),
  "utf8",
);

const longTaskName =
  "Pararoot Visual Identity + Social Media Assets — Option A with an intentionally long title";

describe("FilterDropdownMenu", () => {
  it("opts mobile sheet scroll area into shrinkable content width", () => {
    expect(filterDropdownMenuSource).toContain("shrinkContent");
    expect(filterDropdownMenuSource).toContain("max-w-[100vw]");
  });

  it("truncates long mobile option labels instead of overflowing the sheet", async () => {
    const user = userEvent.setup();

    render(
      <FilterDropdownMenu
        buttonLabel="Filter"
        searchPlaceholder="Search..."
        emptyResultsLabel="No results"
        sections={[
          {
            id: "task",
            label: "Task",
            icon: Folder,
            value: null,
            allLabel: "All",
            onChange: vi.fn(),
            options: [{ value: "task-1", label: longTaskName }],
          },
        ]}
      />,
    );

    await user.click(screen.getByLabelText("Filter"));
    await user.click(screen.getByRole("button", { name: /Task/i }));

    const scrollArea = document.querySelector('[data-slot="scroll-area"]');
    expect(scrollArea).toHaveAttribute("data-scroll-area-shrink-content");

    const optionLabel = screen.getByText(longTaskName);
    expect(optionLabel).toHaveClass(FILTER_DROPDOWN_OPTION_LABEL_CLASS);
  });

  it("supports a controlled sheet without the built-in mobile trigger", async () => {
    const user = userEvent.setup();
    const onSheetOpenChange = vi.fn();

    const { rerender } = render(
      <FilterDropdownMenu
        buttonLabel="Filter"
        searchPlaceholder="Search..."
        emptyResultsLabel="No results"
        hideMobileTrigger
        sheetOpen={false}
        onSheetOpenChange={onSheetOpenChange}
        sections={[
          {
            id: "task",
            label: "Task",
            icon: Folder,
            value: null,
            allLabel: "All",
            onChange: vi.fn(),
            options: [{ value: "task-1", label: "Task One" }],
          },
        ]}
      />,
    );

    expect(screen.queryByLabelText("Filter")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <FilterDropdownMenu
        buttonLabel="Filter"
        searchPlaceholder="Search..."
        emptyResultsLabel="No results"
        hideMobileTrigger
        sheetOpen
        onSheetOpenChange={onSheetOpenChange}
        sections={[
          {
            id: "task",
            label: "Task",
            icon: Folder,
            value: null,
            allLabel: "All",
            onChange: vi.fn(),
            options: [{ value: "task-1", label: "Task One" }],
          },
        ]}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Filter" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onSheetOpenChange).toHaveBeenCalledWith(false);
  });
});
