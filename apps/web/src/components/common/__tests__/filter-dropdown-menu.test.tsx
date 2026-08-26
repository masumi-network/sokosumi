import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Folder } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import {
  FILTER_DROPDOWN_OPTION_LABEL_CLASS,
  FilterDropdownMenu,
} from "@/components/common/filter-dropdown-menu";

const longTaskName =
  "Pararoot Visual Identity + Social Media Assets — Option A with an intentionally long title";

describe("FilterDropdownMenu", () => {
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

    const optionLabel = screen.getByText(longTaskName);
    expect(optionLabel).toHaveClass(FILTER_DROPDOWN_OPTION_LABEL_CLASS);
  });
});
