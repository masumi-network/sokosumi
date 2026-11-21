import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EMPTY_FILE_FILTERS } from "@/lib/utils/file-search.client";
import { DriveFileFilters } from "./drive-file-filters";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("DriveFileFilters", () => {
  it("drops an abandoned desktop popover draft when resizing to mobile and opening the sheet", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    const { rerender } = render(
      <DriveFileFilters
        filters={EMPTY_FILE_FILTERS}
        labels={[]}
        onApply={onApply}
        hideDesktopTrigger={false}
        sheetOpen={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "filterButton" }));
    const imageCheckbox = screen.getByRole("checkbox", { name: "type.image" });
    await user.click(imageCheckbox);
    expect(imageCheckbox).toHaveAttribute("aria-checked", "true");

    // Resize to mobile while the desktop popover was open (it unmounts without onOpenChange).
    rerender(
      <DriveFileFilters
        filters={EMPTY_FILE_FILTERS}
        labels={[]}
        onApply={onApply}
        hideDesktopTrigger
        sheetOpen={false}
      />,
    );

    // Opening the mobile sheet must show applied filters, not the abandoned desktop draft.
    rerender(
      <DriveFileFilters
        filters={EMPTY_FILE_FILTERS}
        labels={[]}
        onApply={onApply}
        hideDesktopTrigger
        sheetOpen
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: "type.image" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("does not revive an abandoned desktop popover when resizing to mobile and back to desktop", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DriveFileFilters
        filters={EMPTY_FILE_FILTERS}
        labels={[]}
        onApply={vi.fn()}
        hideDesktopTrigger={false}
        sheetOpen={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "filterButton" }));
    await user.click(screen.getByRole("checkbox", { name: "type.image" }));

    rerender(
      <DriveFileFilters
        filters={EMPTY_FILE_FILTERS}
        labels={[]}
        onApply={vi.fn()}
        hideDesktopTrigger
        sheetOpen={false}
      />,
    );

    rerender(
      <DriveFileFilters
        filters={EMPTY_FILE_FILTERS}
        labels={[]}
        onApply={vi.fn()}
        hideDesktopTrigger={false}
        sheetOpen={false}
      />,
    );

    expect(
      screen.queryByRole("checkbox", { name: "type.image" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "filterButton" }));
    expect(
      screen.getByRole("checkbox", { name: "type.image" }),
    ).toHaveAttribute("aria-checked", "false");
  });
});
